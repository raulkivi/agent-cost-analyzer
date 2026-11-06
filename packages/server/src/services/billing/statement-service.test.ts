import { describe, expect, it } from "vitest";
import { statementAnswerSchema, type ProjectsFile, type Statement } from "@agent-cost-analyzer/domain";
import { billed, costs, cubeOf, cubeRow } from "../../test-support/cost-cube-fakes.js";
import type { CostCube } from "../cost-analysis/cost-cube.js";
import type { SessionRangeFilter } from "../tool-audit/audit-query-service.js";
import { PeriodNotEndedError, StatementService, UnknownStatementPeriodError } from "./statement-service.js";
import type { StatementStore } from "./statement-store.js";

// Phase 15 step 15.11 (plan §8.5, D6, D15): the draft on demand, the frozen
// copy with the re-run's exact diff, and issuing only an ended period.

class MemoryStore implements StatementStore {
  readonly files = new Map<string, Statement>();
  list(projectId: string) {
    return [...this.files.keys()].filter((key) => key.startsWith(`${projectId}/`)).map((key) => key.split("/")[1]!).sort();
  }
  read(projectId: string, periodKey: string) {
    return this.files.get(`${projectId}/${periodKey}`);
  }
  write(statement: Statement) {
    const key = `${statement.project.id}/${statement.period.key}`;
    if (this.files.has(key)) throw new Error("already issued");
    this.files.set(key, statement);
  }
}

const file: ProjectsFile = {
  version: 1,
  projects: [{ id: "portal", name: "Customer portal", members: [{ repository: "github.com/acme/portal" }] }],
  aliases: {},
  captureRules: [],
};

function setup(options: { now?: string; rows?: CostCube["rows"]; priceBookHash?: string } = {}) {
  const store = new MemoryStore();
  const requests: SessionRangeFilter[] = [];
  let rows = options.rows ?? [cubeRow({ date: "2026-10-05", at: "2026-10-05T10:00:00Z", projectId: "portal", cost: costs({ billed: billed(100) }) })];
  let priceBookHash = options.priceBookHash ?? "pb1";
  const service = new StatementService({
    cubes: { getCube: async (range) => (requests.push(range), cubeOf(rows)) },
    store,
    projects: { load: () => ({ file }) },
    priceBookHash: () => priceBookHash,
    appVersion: "0.9.0",
    timeZone: "Europe/Tallinn",
    now: () => new Date(options.now ?? "2026-11-06T12:00:00Z"),
  });
  return {
    service,
    store,
    requests,
    setRows: (next: CostCube["rows"]) => (rows = next),
    setPriceBookHash: (next: string) => (priceBookHash = next),
  };
}

describe("StatementService", () => {
  it("answers the draft for an ended month, which can be issued, reading sessions around it", async () => {
    const { service, requests } = setup();
    const answer = statementAnswerSchema.parse(await service.get({ projectId: "portal", period: "2026-10", providerId: "vscode" }));
    expect(answer.statement).toMatchObject({ status: "draft", period: { key: "2026-10", timeZone: "Europe/Tallinn" }, totals: [{ currency: "AI_CREDITS", total: 100 }] });
    expect(answer.canIssue).toEqual({ ok: true });
    expect(answer.issuedPeriods).toEqual([]);
    // A day either side, for the time zone; sessions are chosen by their start.
    expect(requests).toEqual([{ providerId: "vscode", since: "2026-09-30", until: "2026-11-01" }]);
    expect(answer.statement.provenance.projectsFileHash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("can't issue a period that hasn't ended, and says why (D15)", async () => {
    const { service } = setup({ now: "2026-10-31T12:00:00Z" });
    expect((await service.get({ projectId: "portal", period: "2026-10" }))?.canIssue).toEqual({ ok: false, reason: "October 2026 hasn't ended yet in Europe/Tallinn; it can be issued from 2026-11-01." });
    await expect(service.issue({ projectId: "portal", period: "2026-10" })).rejects.toBeInstanceOf(PeriodNotEndedError);
  });

  it("issues the draft: frozen, stamped, and then served with the re-run and an empty diff", async () => {
    const { service, store } = setup();
    const issued = await service.issue({ projectId: "portal", period: "2026-10" });
    expect(issued.statement).toMatchObject({ status: "issued", issuedAt: "2026-11-06T12:00:00.000Z" });
    expect(store.read("portal", "2026-10")).toEqual(issued.statement);
    const answer = await service.get({ projectId: "portal", period: "2026-10" });
    expect(answer?.statement.status).toBe("issued");
    expect(answer?.diff?.changed).toBe(false);
    expect(answer?.canIssue).toEqual({ ok: false, reason: "Already issued on 2026-11-06T12:00:00.000Z; a frozen statement is never changed." });
    expect(answer?.issuedPeriods).toEqual(["2026-10"]);
  });

  it("keeps a frozen statement unchanged after a price-book update and late logs, and shows the exact diff", async () => {
    const { service, setRows, setPriceBookHash } = setup();
    const issued = await service.issue({ projectId: "portal", period: "2026-10" });
    setPriceBookHash("pb2");
    setRows([
      cubeRow({ date: "2026-10-05", at: "2026-10-05T10:00:00Z", projectId: "portal", sessionKey: "p:s1", cost: costs({ billed: billed(100) }) }),
      cubeRow({ date: "2026-10-20", at: "2026-10-20T10:00:00Z", projectId: "portal", sessionKey: "p:late", sessionId: "late", cost: costs({ billed: billed(7.5) }) }),
    ]);
    const answer = await service.get({ projectId: "portal", period: "2026-10" });
    expect(answer?.statement).toEqual(issued.statement);
    expect(answer?.diff).toMatchObject({ changed: true, totals: [{ currency: "AI_CREDITS", issued: 100, current: 107.5, difference: 7.5 }], inputs: { priceBookChanged: true } });
  });

  it("gives null for an unknown project and refuses a bad period", async () => {
    const { service } = setup();
    expect(await service.get({ projectId: "nope", period: "2026-10" })).toBeNull();
    await expect(service.get({ projectId: "portal", period: "October" })).rejects.toBeInstanceOf(UnknownStatementPeriodError);
  });
});
