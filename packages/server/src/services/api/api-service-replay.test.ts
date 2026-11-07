import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  sessionReplayComparisonSchema,
  sessionReplaySchema,
  type SessionReplay,
  type SessionReplayComparison,
} from "@agent-cost-analyzer/domain";
import { UnknownLogProviderIdError } from "../../data-sources/log-providers/registry.js";
import {
  TooManyComparedModelsError,
  type CompareRequest,
  type ReplayRequest,
  type ReplayResult,
  type SessionReplayQueries,
} from "../session-replay/session-replay-service.js";
import {
  ApiService,
  SESSION_REPLAY_UNAVAILABLE_MESSAGE,
  type ApiServiceDeps,
} from "./api-service.js";
import { BadRequestError, InternalError, NotFoundError } from "./api-errors.js";

// Phase 14 step 14.5 (plan §9, threat-model.md §4): getSessionReplay and
// compareSessionReplay parse their query, call the replay service and map
// its statuses to the API's typed errors; a product without it answers 404.

// The 14.4 goldens, so the fakes answer what the real service does.
const golden = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(`../session-replay/__golden__/${name}.json`, import.meta.url),
      ),
      "utf8",
    ),
  );
const replay = (golden("claude-code-normal-session") as SessionReplay[])[0]!;
const comparison = golden(
  "claude-code-normal-session-compare",
) as SessionReplayComparison;

type Outcome<T> = ReplayResult<T> | Error;

function fake(
  replayOutcome: Outcome<SessionReplay> = { status: "ok", value: replay },
  compareOutcome: Outcome<SessionReplayComparison> = {
    status: "ok",
    value: comparison,
  },
) {
  const calls: { replay: ReplayRequest[]; compare: CompareRequest[] } = {
    replay: [],
    compare: [],
  };
  const queries: SessionReplayQueries = {
    async replay(request) {
      calls.replay.push(request);
      if (replayOutcome instanceof Error) throw replayOutcome;
      return replayOutcome;
    },
    async compare(request) {
      calls.compare.push(request);
      if (compareOutcome instanceof Error) throw compareOutcome;
      return compareOutcome;
    },
  };
  return { queries, calls };
}

function service(sessionReplay?: SessionReplayQueries): ApiService {
  return new ApiService({
    ...(sessionReplay ? { sessionReplay } : {}),
  } as ApiServiceDeps);
}

describe("ApiService session replay", () => {
  it("passes the parsed replay query on and answers a schema-valid replay", async () => {
    const { queries, calls } = fake();
    const answer = await service(queries).getSessionReplay("s1", {
      model: " claude-haiku-5.5 ",
      pricing: "api",
      provider: "claude-code",
    });
    expect(sessionReplaySchema.parse(answer)).toEqual(replay);
    expect(calls.replay).toEqual([
      {
        sessionId: "s1",
        model: "claude-haiku-5.5",
        pricing: "api",
        providerId: "claude-code",
      },
    ]);
  });

  it("passes the parsed compare query on, models as a string or an array", async () => {
    const { queries, calls } = fake();
    const api = service(queries);
    const answer = await api.compareSessionReplay("s1", { models: "a,b,a" });
    expect(sessionReplayComparisonSchema.parse(answer)).toEqual(comparison);
    await api.compareSessionReplay("s1", {
      models: ["c", "d"],
      pricing: "copilot",
    });
    expect(calls.compare).toEqual([
      { sessionId: "s1", models: ["a", "b"] },
      { sessionId: "s1", models: ["c", "d"], pricing: "copilot" },
    ]);
  });

  it("rejects a bad query as a bad request without calling the service", async () => {
    const { queries, calls } = fake();
    const api = service(queries);
    await expect(api.getSessionReplay("s1", {})).rejects.toBeInstanceOf(
      BadRequestError,
    );
    await expect(api.getSessionReplay("s1")).rejects.toBeInstanceOf(
      BadRequestError,
    );
    await expect(
      api.getSessionReplay("s1", { model: "m", pricing: "contract" }),
    ).rejects.toBeInstanceOf(BadRequestError);
    await expect(
      api.compareSessionReplay("s1", { models: "" }),
    ).rejects.toBeInstanceOf(BadRequestError);
    await expect(
      api.compareSessionReplay("s1", {
        models: Array.from({ length: 11 }, (_, i) => `m${i}`).join(","),
      }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(calls).toEqual({ replay: [], compare: [] });
  });

  it("maps an unknown session to 404 with the API's wording", async () => {
    const { queries } = fake(
      { status: "unknown-session" },
      { status: "unknown-session" },
    );
    const api = service(queries);
    await expect(api.getSessionReplay("nope", { model: "m" })).rejects.toEqual(
      new NotFoundError('Unknown session id "nope"'),
    );
    await expect(
      api.compareSessionReplay("nope", { models: "m" }),
    ).rejects.toEqual(new NotFoundError('Unknown session id "nope"'));
  });

  it("maps an unknown model to 400 with the service's reason", async () => {
    const reason = 'No vendor profile lists the model "m".';
    const { queries } = fake(
      { status: "unknown-model", reason },
      { status: "unknown-model", reason },
    );
    const api = service(queries);
    await expect(api.getSessionReplay("s1", { model: "m" })).rejects.toEqual(
      new BadRequestError(reason),
    );
    await expect(
      api.compareSessionReplay("s1", { models: "m" }),
    ).rejects.toEqual(new BadRequestError(reason));
  });

  it("maps a session that can't be replayed to 404 with the reason", async () => {
    const reason = "This provider's logs can't be replayed yet.";
    const { queries } = fake(
      { status: "not-replayable", reason },
      { status: "not-replayable", reason },
    );
    const api = service(queries);
    await expect(api.getSessionReplay("s1", { model: "m" })).rejects.toEqual(
      new NotFoundError(reason),
    );
    await expect(
      api.compareSessionReplay("s1", { models: "m" }),
    ).rejects.toEqual(new NotFoundError(reason));
  });

  it("maps too many models (the session's own included) and an unknown provider to 400", async () => {
    const { queries } = fake(
      new UnknownLogProviderIdError("nope"),
      new TooManyComparedModelsError(11),
    );
    const api = service(queries);
    await expect(
      api.getSessionReplay("s1", { model: "m", provider: "nope" }),
    ).rejects.toBeInstanceOf(BadRequestError);
    const tooMany = api.compareSessionReplay("s1", { models: "m" });
    await expect(tooMany).rejects.toBeInstanceOf(BadRequestError);
    await expect(tooMany).rejects.toThrow(/At most 10 models/);
  });

  it("reports any other failure as internal", async () => {
    const { queries } = fake(new Error("disk"), new Error("disk"));
    const api = service(queries);
    await expect(
      api.getSessionReplay("s1", { model: "m" }),
    ).rejects.toBeInstanceOf(InternalError);
    await expect(
      api.compareSessionReplay("s1", { models: "m" }),
    ).rejects.toBeInstanceOf(InternalError);
  });

  it("is not found in a product without session replay", async () => {
    const unavailable = new NotFoundError(SESSION_REPLAY_UNAVAILABLE_MESSAGE);
    expect(SESSION_REPLAY_UNAVAILABLE_MESSAGE).toBe(
      "Session replay is not available in this product.",
    );
    await expect(
      service().getSessionReplay("s1", { model: "m" }),
    ).rejects.toEqual(unavailable);
    await expect(
      service().compareSessionReplay("s1", { models: "m" }),
    ).rejects.toEqual(unavailable);
  });
});
