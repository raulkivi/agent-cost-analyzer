// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { AuditQueryService } from "./audit-query-service.js";
import { FakeProvider, lookup, sampleSessions as sessions, session, shell } from "../../test-support/audit-fakes.js";

describe("AuditQueryService", () => {
  it("lists sessions most recent first, filtered by date range and limit", async () => {
    const service = new AuditQueryService(lookup(new FakeProvider("fake", sessions)));

    expect((await service.listSessions({})).map((s) => s.id)).toEqual(["new", "mid", "old"]);
    expect((await service.listSessions({ since: "2026-09-15" })).map((s) => s.id)).toEqual(["new", "mid"]);
    expect((await service.listSessions({ until: "2026-09-20" })).map((s) => s.id)).toEqual(["mid", "old"]);
    expect((await service.listSessions({ limit: 1 })).map((s) => s.id)).toEqual(["new"]);
  });

  it("reads through a named provider instead of the active one", async () => {
    const other = new FakeProvider("other", [session("x", "2026-09-27T00:00:00Z", [])]);
    const service = new AuditQueryService(lookup(new FakeProvider("fake", sessions), other));

    expect((await service.listSessions({ providerId: "other" })).map((s) => s.id)).toEqual(["x"]);
  });

  it("returns a session audit, or null for an unknown session", async () => {
    const service = new AuditQueryService(lookup(new FakeProvider("fake", sessions)));

    expect((await service.getSessionAudit("new"))?.totals.failed).toBe(1);
    expect(await service.getSessionAudit("missing")).toBeNull();
  });

  it("filters a session's tool calls by status, category, tool, program and turn", async () => {
    const service = new AuditQueryService(lookup(new FakeProvider("fake", sessions)));

    const failed = await service.listToolCalls("mid", { status: ["error"] });
    expect(failed?.total).toBe(1);
    expect(failed?.calls[0].call.outcome?.failureCategory).toBe("wrong-directory");

    expect((await service.listToolCalls("mid", { failureCategory: ["command-not-found"] }))?.total).toBe(0);
    expect((await service.listToolCalls("mid", { program: "ls" }))?.total).toBe(2);
    expect((await service.listToolCalls("new", { turnIndex: 1 }))?.calls.map((c) => c.call.argsSummary)).toEqual(["npm test"]);
    expect((await service.listToolCalls("new", { tool: "Read" }))?.total).toBe(0);
    expect((await service.listToolCalls("new", { limit: 1 }))?.calls).toHaveLength(1);
    expect((await service.listToolCalls("new", { limit: 1 }))?.total).toBe(2);
    expect(await service.listToolCalls("missing", {})).toBeNull();
  });

  it("filters tool calls by kind and pages them with offset", async () => {
    const service = new AuditQueryService(lookup(new FakeProvider("fake", sessions)));

    expect((await service.listToolCalls("mid", { kind: ["shell"] }))?.total).toBe(2);
    expect((await service.listToolCalls("mid", { kind: ["web"] }))?.total).toBe(0);
    const page = await service.listToolCalls("new", { offset: 1, limit: 1 });
    expect(page?.total).toBe(2);
    expect(page?.calls.map((c) => c.call.argsSummary)).toEqual(["npm test"]);
  });

  it("filters sessions by a case-insensitive title or id query", async () => {
    const service = new AuditQueryService(lookup(new FakeProvider("fake", sessions)));

    expect((await service.listSessions({ query: "SESSION MID" })).map((s) => s.id)).toEqual(["mid"]);
    expect((await service.listSessions({ query: "old" })).map((s) => s.id)).toEqual(["old"]);
  });

  it("builds a rollup over the most recent sessions in range", async () => {
    const provider = new FakeProvider("fake", sessions);
    const service = new AuditQueryService(lookup(provider));

    const rollup = await service.getRollup({ since: "2026-09-15" });

    expect(rollup.providerId).toBe("fake");
    expect(rollup.sessionCount).toBe(2);
    expect(rollup.totals.failed).toBe(2);
    expect(rollup.topFailingCommands.map((c) => c.command)).toEqual(["cd x && ls", "foo"]);
    expect(provider.reads).toBe(2);
  });

  it("leaves Agent Host sessions out of the rollup and reports how many", async () => {
    const agentHost = { ...session("ah", "2026-09-26T08:00:00Z", []), copilotHarness: "agent-host" as const };
    const service = new AuditQueryService(lookup(new FakeProvider("fake", [...sessions, agentHost])));

    const rollup = await service.getRollup({});

    expect(rollup.sessionCount).toBe(3);
    expect(rollup.sessionsWithUnknownToolCalls).toBe(1);
    expect(rollup.sessions.map((s) => s.sessionId)).not.toContain("ah");
    expect(rollup.toolCallsUnavailableReason).toMatch(/aren't read yet/);
  });

  it("caps the rollup's session count", async () => {
    const service = new AuditQueryService(lookup(new FakeProvider("fake", sessions)));
    expect((await service.getRollup({ limit: 1 })).sessionCount).toBe(1);
  });

  describe("origin filters (step 10.20)", () => {
    const inRun = (command: string, runId: string) => ({
      ...shell(command, "success"),
      origin: { kind: "subagent" as const, runId, label: "searchSubagent", depth: 1 },
    });
    const withRuns = session("runs", "2026-09-28T10:00:00Z", [
      [shell("main one", "success"), inRun("run a1", "ra"), inRun("run a2", "ra")],
      [{ ...shell("main two", "success"), origin: { kind: "main" as const } }, inRun("run b1", "rb")],
    ]);
    const service = () => new AuditQueryService(lookup(new FakeProvider("fake", [withRuns])));
    const commands = (result: Awaited<ReturnType<AuditQueryService["listToolCalls"]>>) => result?.calls.map((c) => c.call.argsSummary);

    it("returns main and subagent calls by default, so a client that ignores origin gets true totals (D9)", async () => {
      expect((await service().listToolCalls("runs", {}))?.total).toBe(5);
    });

    it("filters to the main agent, treating a record without origin as main", async () => {
      expect(commands(await service().listToolCalls("runs", { origin: ["main"] }))).toEqual(["main one", "main two"]);
    });

    it("filters to subagent calls", async () => {
      expect(commands(await service().listToolCalls("runs", { origin: ["subagent"] }))).toEqual(["run a1", "run a2", "run b1"]);
    });

    it("returns both when both origins are named", async () => {
      expect((await service().listToolCalls("runs", { origin: ["main", "subagent"] }))?.total).toBe(5);
    });

    it("filters to one run by id", async () => {
      expect(commands(await service().listToolCalls("runs", { runId: "ra" }))).toEqual(["run a1", "run a2"]);
      expect((await service().listToolCalls("runs", { runId: "nope" }))?.total).toBe(0);
    });

    it("never returns a main call for a run id, even with origin main", async () => {
      expect((await service().listToolCalls("runs", { runId: "ra", origin: ["main"] }))?.total).toBe(0);
    });

    it("combines with the other filters and with paging", async () => {
      const result = await service().listToolCalls("runs", { origin: ["subagent"], turnIndex: 0, offset: 1, limit: 1 });

      expect(result?.total).toBe(2);
      expect(commands(result)).toEqual(["run a2"]);
    });

    it("returns the audit's run rows from getSessionAudit", async () => {
      const audit = await service().getSessionAudit("runs");

      expect(audit?.subagentRuns?.map((r) => r.runId)).toEqual(["ra", "rb"]);
      expect(audit?.byOrigin?.subagents).toMatchObject({ toolCalls: 3, runs: 2 });
    });
  });
});
