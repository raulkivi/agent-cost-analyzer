import { describe, expect, it } from "vitest";
import {
  apiMethodSchema,
  type ConfigStatus,
  type InsightsDataset,
  type ProductProfile,
  type Session,
  type TurnInspectorDetail,
} from "@copilot-cost-analyzer/domain";
import { FakeProvider, sampleSessions } from "../../test-support/audit-fakes.js";
import { InMemoryAppSettingsStore } from "../../test-support/in-memory-app-settings-store.js";
import { LogProviderRegistry, UnknownLogProviderIdError } from "../../data-sources/log-providers/registry.js";
import type { LogProvider } from "../../data-sources/log-providers/log-provider.js";
import type { SystemPromptTextLookup } from "../../data-sources/log-providers/system-prompt-text-reader.js";
import type { LearnScenarioCatalog } from "../../data-sources/learn-scenarios/loader.js";
import { AuditQueryService, type SessionRangeFilter } from "../tool-audit/audit-query-service.js";
import { ApiService, type ApiServiceDeps } from "./api-service.js";
import { BadRequestError, InternalError, NotFoundError, statusForApiError } from "./api-errors.js";

const profile: ProductProfile = {
  productId: "standalone",
  displayName: "Agent Cost Analyzer",
  version: "1.2.3",
  features: { providerSelect: true, crossProviderInsights: true, settingFixes: false, openInEditor: false, sessionSidebar: false },
};

const learnScenario = { ...sampleSessions[0], id: "learn-1", mode: "learn" as const };
const learnScenarios: LearnScenarioCatalog = {
  list: () => [learnScenario],
  get: (id) => (id === learnScenario.id ? learnScenario : undefined),
};

function configStatusFor(threshold: number | undefined): ConfigStatus {
  return {
    checkedAt: "2026-10-24T00:00:00.000Z",
    vscodeUserSettingsPath: null,
    loggingEnabled: false,
    maxRetainedSessionLogs: null,
    minRetainedSessionLogsThreshold: threshold ?? 200,
    warnings: [],
  };
}

const detail: TurnInspectorDetail = { turnIndex: 0, userMessage: [], rounds: [] };

// A FakeProvider whose readTurnDetail knows turn 0 of its sessions.
function detailProvider(id: string, sessions: Session[]): LogProvider {
  const provider = new FakeProvider(id, sessions);
  return Object.assign(provider, {
    readTurnDetail: async (sessionId: string, turnIndex: number) =>
      (await provider.readSession(sessionId)) && turnIndex === 0 ? detail : null,
  });
}

class SystemPromptProvider extends FakeProvider {
  constructor(id: string, private readonly lookups: Record<string, SystemPromptTextLookup>) {
    super(id, sampleSessions);
  }
  async lookupSystemPromptText(sessionId: string): Promise<SystemPromptTextLookup> {
    return this.lookups[sessionId] ?? { status: "unknown-session" };
  }
}

// Every source read fails — the "provider failure → Internal" path.
class BrokenProvider extends FakeProvider {
  constructor(id = "vscode") {
    super(id, []);
  }
  override async readSession(): Promise<Session | null> {
    throw new Error("store is corrupt");
  }
  override async readTurnDetail(): Promise<TurnInspectorDetail | null> {
    throw new Error("store is corrupt");
  }
  override async listSessions(): Promise<Session[]> {
    throw new Error("store is corrupt");
  }
  async lookupSystemPromptText(): Promise<SystemPromptTextLookup> {
    throw new Error("store is corrupt");
  }
}

// The error's class and exact message, since toThrow(new X(...)) only
// compares messages.
async function expectApiError(
  promise: Promise<unknown>,
  type: typeof BadRequestError | typeof NotFoundError | typeof InternalError,
  message: string,
): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(type);
  expect((error as Error).message).toBe(message);
}

function build(
  providers: LogProvider[] = [detailProvider("vscode", sampleSessions)],
  overrides: Partial<ApiServiceDeps> = {},
): { service: ApiService; settings: InMemoryAppSettingsStore; registry: LogProviderRegistry } {
  const settings = new InMemoryAppSettingsStore();
  const registry = new LogProviderRegistry(providers, settings);
  const service = new ApiService({
    registry,
    auditQueries: new AuditQueryService(registry),
    insights: { getDataset: async () => ({ generatedAt: "now" }) as unknown as InsightsDataset },
    settings,
    checkConfig: configStatusFor,
    learnScenarios,
    appVersion: "1.2.3",
    productProfile: profile,
    ...overrides,
  });
  return { service, settings, registry };
}

describe("ApiService", () => {
  it("implements every ApiMethod the transports share", () => {
    const { service } = build();

    for (const method of apiMethodSchema.options) {
      expect(typeof service[method]).toBe("function");
    }
  });

  describe("health and product profile", () => {
    it("getHealth reports ok with the injected app version", async () => {
      await expect(build().service.getHealth()).resolves.toEqual({ status: "ok", version: "1.2.3" });
    });

    it("getProductProfile returns the injected profile", async () => {
      await expect(build().service.getProductProfile()).resolves.toEqual(profile);
    });
  });

  describe("sessions", () => {
    it("listSessions reads the active provider's summaries", async () => {
      const sessions = await build().service.listSessions();

      expect(sessions.map((session) => session.id)).toEqual(["old", "mid", "new"]);
    });

    it("listSessions lets a provider failure through unchanged", async () => {
      await expect(build([new BrokenProvider()]).service.listSessions()).rejects.toThrow("store is corrupt");
    });

    it("getSession returns the full session", async () => {
      await expect(build().service.getSession("mid")).resolves.toMatchObject({ id: "mid" });
    });

    it("getSession throws NotFoundError for an unknown id", async () => {
      const promise = build().service.getSession("nope");

      await expect(promise).rejects.toBeInstanceOf(NotFoundError);
      await expect(promise).rejects.toThrow('Unknown session id "nope"');
    });

    it("getSession wraps a provider failure in InternalError", async () => {
      const promise = build([new BrokenProvider()]).service.getSession("x");

      await expect(promise).rejects.toBeInstanceOf(InternalError);
      await expect(promise).rejects.toThrow('Failed to load session "x": store is corrupt');
    });
  });

  describe("getTurnDetail", () => {
    it("returns the turn's detail for a numeric or numeric-string index", async () => {
      const { service } = build();

      await expect(service.getTurnDetail("old", 0)).resolves.toEqual(detail);
      await expect(service.getTurnDetail("old", "0")).resolves.toEqual(detail);
    });

    it.each([["not-a-number"], ["-1"], [-1], [1.5], [""]])("rejects turn index %j with BadRequestError", async (turnIndex) => {
      const promise = build().service.getTurnDetail("old", turnIndex);

      await expect(promise).rejects.toBeInstanceOf(BadRequestError);
      await expect(promise).rejects.toThrow(`"${String(turnIndex)}" is not a valid turn index.`);
    });

    it("throws NotFoundError for an unknown session or turn", async () => {
      const promise = build().service.getTurnDetail("old", 3);

      await expect(promise).rejects.toBeInstanceOf(NotFoundError);
      await expect(promise).rejects.toThrow('Unknown session id "old" or turn index 3');
    });

    it("wraps a provider failure in InternalError", async () => {
      await expectApiError(
        build([new BrokenProvider()]).service.getTurnDetail("x", 2),
        InternalError,
        'Failed to load turn 2 for session "x": store is corrupt',
      );
    });
  });

  describe("getSystemPromptText (SystemPromptTextReader capability, G1)", () => {
    const reader = new SystemPromptProvider("vscode", {
      found: { status: "found", text: "You are helpful." },
      bare: { status: "not-captured" },
    });

    it("returns the active provider's captured text", async () => {
      await expect(build([reader]).service.getSystemPromptText("found")).resolves.toBe("You are helpful.");
    });

    it("throws NotFoundError with the artifact message for a session with nothing captured", async () => {
      await expectApiError(
        build([reader]).service.getSystemPromptText("bare"),
        NotFoundError,
        'No system-prompt artifact captured for session "bare"',
      );
    });

    it("throws NotFoundError with the unknown-session message for an id the provider doesn't know", async () => {
      await expectApiError(
        build([reader]).service.getSystemPromptText("nope"),
        NotFoundError,
        'Unknown session id "nope"',
      );
    });

    it("treats every session of a provider without the capability as unknown", async () => {
      const promise = build([new FakeProvider("vscode", sampleSessions)]).service.getSystemPromptText("old");

      await expect(promise).rejects.toBeInstanceOf(NotFoundError);
      await expect(promise).rejects.toThrow('Unknown session id "old"');
    });

    it("asks only the active provider", async () => {
      const { service, registry } = build([reader, new FakeProvider("other", sampleSessions)]);
      registry.setActive("other");

      await expect(service.getSystemPromptText("found")).rejects.toBeInstanceOf(NotFoundError);
    });

    it("wraps a provider failure in InternalError", async () => {
      await expectApiError(
        build([new BrokenProvider()]).service.getSystemPromptText("x"),
        InternalError,
        'Failed to load system prompt for session "x": store is corrupt',
      );
    });
  });

  describe("config status and retention threshold", () => {
    it("getConfigStatus checks config with the persisted threshold", async () => {
      const { service, settings } = build();
      settings.writeMinRetainedSessionLogsThreshold(300);

      await expect(service.getConfigStatus()).resolves.toMatchObject({ minRetainedSessionLogsThreshold: 300 });
    });

    it("setRetentionThreshold persists a positive integer and returns the new status", async () => {
      const { service, settings } = build();

      await expect(service.setRetentionThreshold(250)).resolves.toMatchObject({ minRetainedSessionLogsThreshold: 250 });
      expect(settings.readMinRetainedSessionLogsThreshold()).toBe(250);
    });

    it.each([[0], [-5], [1.5], ["300"], [undefined], [null]])("rejects threshold %j with BadRequestError and persists nothing", async (value) => {
      const { service, settings } = build();

      await expectApiError(
        service.setRetentionThreshold(value),
        BadRequestError,
        'Request body must include a positive integer "value".',
      );
      expect(settings.readMinRetainedSessionLogsThreshold()).toBeUndefined();
    });
  });

  describe("learn scenarios", () => {
    it("listLearnScenarios returns the injected catalog's scenarios", async () => {
      await expect(build().service.listLearnScenarios()).resolves.toEqual([learnScenario]);
    });

    it("getLearnScenario returns one scenario by id", async () => {
      await expect(build().service.getLearnScenario("learn-1")).resolves.toEqual(learnScenario);
    });

    it("getLearnScenario throws NotFoundError for an unknown id", async () => {
      await expectApiError(build().service.getLearnScenario("nope"), NotFoundError, 'Unknown learn scenario id "nope"');
    });
  });

  describe("log providers", () => {
    const providers = () => [new FakeProvider("vscode", []), new FakeProvider("pi-agent", [])];

    it("getLogProviderStatus lists the registry's providers and active id", async () => {
      await expect(build(providers()).service.getLogProviderStatus()).resolves.toMatchObject({
        activeProviderId: "vscode",
        providers: [{ id: "vscode" }, { id: "pi-agent" }],
      });
    });

    it("setActiveLogProvider switches, persists and returns the new status", async () => {
      const { service, settings } = build(providers());

      await expect(service.setActiveLogProvider("pi-agent")).resolves.toMatchObject({ activeProviderId: "pi-agent" });
      expect(settings.readActiveProviderId()).toBe("pi-agent");
    });

    it.each([[undefined], [""], [42]])("rejects provider id %j with BadRequestError", async (id) => {
      await expectApiError(
        build(providers()).service.setActiveLogProvider(id),
        BadRequestError,
        'Request body must include a string "id".',
      );
    });

    it("rejects an unregistered provider id with BadRequestError", async () => {
      await expectApiError(
        build(providers()).service.setActiveLogProvider("nope"),
        BadRequestError,
        'Unknown log provider id "nope"',
      );
    });
  });

  describe("tool-call audit", () => {
    it("getSessionAudit audits a session of the active provider", async () => {
      await expect(build().service.getSessionAudit("mid")).resolves.toMatchObject({ sessionId: "mid" });
    });

    it("getSessionAudit honours a ?provider= query", async () => {
      const { service } = build([new FakeProvider("vscode", []), new FakeProvider("other", sampleSessions)]);

      await expect(service.getSessionAudit("mid", { provider: "other" })).resolves.toMatchObject({ sessionId: "mid" });
    });

    it("getSessionAudit throws NotFoundError for an unknown session", async () => {
      await expectApiError(build().service.getSessionAudit("nope"), NotFoundError, 'Unknown session id "nope"');
    });

    it("getSessionAudit rejects an unknown provider with BadRequestError", async () => {
      await expectApiError(
        build().service.getSessionAudit("mid", { provider: "nope" }),
        BadRequestError,
        'Unknown log provider id "nope"',
      );
    });

    it("getSessionAudit wraps a provider failure in InternalError", async () => {
      await expectApiError(
        build([new BrokenProvider()]).service.getSessionAudit("x"),
        InternalError,
        'Failed to load audit for session "x": store is corrupt',
      );
    });

    it("listToolCalls applies the parsed filter query", async () => {
      const result = await build().service.listToolCalls("mid", { status: "error" });

      expect(result.calls.map((audited) => audited.call.outcome?.status)).toEqual(["error"]);
    });

    it("listToolCalls rejects an invalid filter query with BadRequestError", async () => {
      const promise = build().service.listToolCalls("mid", { status: "bogus" });

      await expect(promise).rejects.toBeInstanceOf(BadRequestError);
      await expect(promise).rejects.toThrow(/^status\.0: /);
    });

    it("listToolCalls throws NotFoundError for an unknown session", async () => {
      await expectApiError(build().service.listToolCalls("nope"), NotFoundError, 'Unknown session id "nope"');
    });

    it("listToolCalls wraps a provider failure in InternalError", async () => {
      await expectApiError(
        build([new BrokenProvider()]).service.listToolCalls("x"),
        InternalError,
        'Failed to load tool calls for session "x": store is corrupt',
      );
    });

    it("getAuditRollup rolls up the parsed session range", async () => {
      const rollup = await build().service.getAuditRollup({ since: "2026-09-15" });

      expect(rollup.sessionCount).toBe(2);
    });

    it("getAuditRollup rejects an invalid range query with BadRequestError", async () => {
      await expect(build().service.getAuditRollup({ limit: "0" })).rejects.toBeInstanceOf(BadRequestError);
    });

    it("getAuditRollup wraps a provider failure in InternalError", async () => {
      await expectApiError(
        build([new BrokenProvider()]).service.getAuditRollup(),
        InternalError,
        "Failed to load audit rollup: store is corrupt",
      );
    });
  });

  describe("getInsights", () => {
    it("passes the parsed session range to the insights service", async () => {
      const filters: SessionRangeFilter[] = [];
      const { service } = build(undefined, {
        insights: {
          getDataset: async (filter) => {
            filters.push(filter);
            return {} as InsightsDataset;
          },
        },
      });

      await service.getInsights({ provider: "vscode", since: "2026-09-01", limit: "5" });

      expect(filters).toEqual([{ providerId: "vscode", since: "2026-09-01", limit: 5 }]);
    });

    it("rejects an invalid range query with BadRequestError", async () => {
      await expect(build().service.getInsights({ since: "yesterday" })).rejects.toBeInstanceOf(BadRequestError);
    });

    it("maps an unknown provider to BadRequestError and other failures to InternalError", async () => {
      const failing = (error: Error) =>
        build(undefined, { insights: { getDataset: async () => Promise.reject(error) } }).service.getInsights();

      await expectApiError(
        failing(new UnknownLogProviderIdError("nope")),
        BadRequestError,
        'Unknown log provider id "nope"',
      );
      await expectApiError(failing(new Error("boom")), InternalError, "Failed to load insights: boom");
    });
  });
});

describe("statusForApiError", () => {
  it("maps each typed error to the status both transports report (vscode-extension.md §4)", () => {
    expect(statusForApiError(new BadRequestError("x"))).toBe(400);
    expect(statusForApiError(new NotFoundError("x"))).toBe(404);
    expect(statusForApiError(new InternalError("x"))).toBe(500);
    expect(statusForApiError(new Error("x"))).toBe(500);
  });
});
