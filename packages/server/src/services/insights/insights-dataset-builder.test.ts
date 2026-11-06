import { describe, expect, it } from "vitest";
import {
  estimatedTokenCount,
  insightSessionRowSchema,
  insightTurnRowSchema,
  type ToolCallRecord,
} from "@agent-cost-analyzer/domain";
import type { Attribution } from "../cost-attribution/session-attributor.js";
import { analyzeSession, bash, providerSessions, turn, usage } from "../../test-support/insights-fakes.js";
import { buildInsightRows, NOT_ATTRIBUTED, type RowAttributor } from "./insights-dataset-builder.js";
import type { CostFigure, Session, Turn } from "@agent-cost-analyzer/domain";
import { costBasisTotals } from "@agent-cost-analyzer/domain";
import { TurnCostFigureBuilder, type TurnPricer } from "../pricing/turn-cost-figures.js";

const portal: Attribution = {
  repository: { attributed: true, repository: { key: "github.com/acme/portal", source: "git-remote", rootPath: "/work/portal" } },
  projectId: "portal",
  vendor: { known: true, vendorId: "anthropic", basis: "profile" },
  channel: { known: true, channel: "github-copilot" },
};

const unattributed: Attribution = {
  repository: { attributed: false, reason: "No folder recorded." },
  projectId: null,
  vendor: { known: false, reason: "No vendor profile lists the model." },
  channel: { known: false, reason: "No channel is known." },
};

// Session rows get `portal`; turn 1 of each session ran outside any repository.
const fakeAttributor: RowAttributor = {
  session: () => portal,
  turn: (_providerId, _session, turnValue) => (turnValue.index === 1 ? unattributed : portal),
};

describe("buildInsightRows", () => {
  it("flattens sessions, turns and tool calls with provider-scoped keys", () => {
    const rows = buildInsightRows([
      providerSessions([analyzeSession("s1", "2026-10-10T09:15:00.000Z", [turn(0, [bash("npm test")])], "gpt-5")], "vscode", "VS Code"),
    ]);

    expect(rows.sessions).toEqual([
      {
        key: "vscode:s1",
        providerId: "vscode",
        providerLabel: "VS Code",
        sessionId: "s1",
        title: "Session s1",
        model: "gpt-5",
        startedAt: "2026-10-10T09:15:00.000Z",
        date: "2026-10-10",
        hour: 9,
        repositoryKey: null,
        unattributedReason: NOT_ATTRIBUTED.repository.attributed ? "" : NOT_ATTRIBUTED.repository.reason,
        projectId: null,
        vendorId: null,
        vendorUnknownReason: NOT_ATTRIBUTED.vendor.known ? "" : NOT_ATTRIBUTED.vendor.reason,
        channel: null,
        channelUnknownReason: NOT_ATTRIBUTED.channel.known ? "" : NOT_ATTRIBUTED.channel.reason,
        cost: costBasisTotals(rows.turns.map((row) => row.cost!)),
      },
    ]);
    expect(rows.turns[0]).toMatchObject({ key: "vscode:s1:0", sessionKey: "vscode:s1", turnIndex: 0, toolCallCount: 1 });
    expect(rows.toolCalls).toEqual([
      {
        key: "vscode:s1:0:0",
        turnKey: "vscode:s1:0",
        name: "Bash",
        kind: "shell",
        program: "npm",
        status: "success",
        command: "npm test",
      },
    ]);
  });

  it("puts each session's and turn's repository, project, vendor and channel on its row (step 15.4)", () => {
    const rows = buildInsightRows([providerSessions([analyzeSession("s1", undefined, [turn(0), turn(1)])], "vscode")], fakeAttributor);

    expect(rows.sessions[0]).toMatchObject({
      repositoryKey: "github.com/acme/portal",
      projectId: "portal",
      vendorId: "anthropic",
      channel: "github-copilot",
    });
    expect(rows.turns[0]).toMatchObject({
      repositoryKey: "github.com/acme/portal",
      projectId: "portal",
      vendorId: "anthropic",
      channel: "github-copilot",
    });
    expect(rows.sessions[0]).not.toHaveProperty("unattributedReason");
    for (const row of rows.sessions) {
      expect(insightSessionRowSchema.parse(row)).toEqual(row);
    }
    for (const row of rows.turns) {
      expect(insightTurnRowSchema.parse(row)).toEqual(row);
    }
  });

  it("keeps an Unattributed turn's reason, and unknown vendor and channel as null with reasons", () => {
    const rows = buildInsightRows([providerSessions([analyzeSession("s1", undefined, [turn(0), turn(1)])])], fakeAttributor);

    expect(rows.turns[1]).toMatchObject({
      repositoryKey: null,
      unattributedReason: "No folder recorded.",
      projectId: null,
      vendorId: null,
      vendorUnknownReason: "No vendor profile lists the model.",
      channel: null,
      channelUnknownReason: "No channel is known.",
    });
  });

  it("marks Agent Host sessions' tool calls as unknown instead of 0", () => {
    const session = { ...analyzeSession("ah", undefined, [turn(0)]), copilotHarness: "agent-host" as const };
    const rows = buildInsightRows([providerSessions([session])]);

    expect(rows.sessions[0]).toMatchObject({ toolCallsUnavailable: true });
    expect(rows.turns[0]?.toolCallCount).toBeNull();
  });

  it("counts an Agent Host session whose event log was read, except a turn the log can't be matched to", () => {
    const unmatched = { ...turn(1), toolCallsUnavailableReason: "no user message in the log" };
    const session = {
      ...analyzeSession("ah", undefined, [turn(0, [bash("npm test")]), unmatched]),
      copilotHarness: "agent-host" as const,
      copilotEventLog: { status: "read" as const },
    };
    const rows = buildInsightRows([providerSessions([session])]);

    expect(rows.sessions[0]?.toolCallsUnavailable).toBeUndefined();
    expect(rows.turns.map((row) => row.toolCallCount)).toEqual([1, null]);
  });

  it("keeps an Agent Host session whose event log is missing out of tool-call counts", () => {
    const session = {
      ...analyzeSession("ah", undefined, [turn(0)]),
      copilotHarness: "agent-host" as const,
      copilotEventLog: { status: "missing" as const, reason: "no log" },
    };
    const rows = buildInsightRows([providerSessions([session])]);

    expect(rows.sessions[0]).toMatchObject({ toolCallsUnavailable: true });
    expect(rows.turns[0]?.toolCallCount).toBeNull();
  });

  it("keeps the same session id from two providers apart", () => {
    const rows = buildInsightRows([
      providerSessions([analyzeSession("s1", undefined, [turn(0)])], "a"),
      providerSessions([analyzeSession("s1", undefined, [turn(0)])], "b"),
    ]);
    expect(rows.sessions.map((row) => row.key)).toEqual(["a:s1", "b:s1"]);
    expect(rows.turns.map((row) => row.key)).toEqual(["a:s1:0", "b:s1:0"]);
  });

  it("turns an unknown token figure into null, not 0", () => {
    const rows = buildInsightRows([
      providerSessions([analyzeSession("s1", undefined, [turn(0, [], usage({ credits: null, read: 500 }))])]),
    ]);
    expect(rows.turns[0]).toMatchObject({ aiCredits: null, cacheRead: 500, reasoning: null, estimated: false });
  });

  it("marks a turn whose figures include a local-tokenizer estimate", () => {
    const estimatedUsage = { ...usage(), uncachedInput: estimatedTokenCount(42) };
    const rows = buildInsightRows([providerSessions([analyzeSession("s1", undefined, [turn(0, [], estimatedUsage)])])]);
    expect(rows.turns[0]).toMatchObject({ uncachedInput: 42, estimated: true });
  });

  it("omits date and hour when the session has no start time", () => {
    const rows = buildInsightRows([providerSessions([analyzeSession("s1", undefined, [])])]);
    expect(rows.sessions[0]).not.toHaveProperty("date");
    expect(rows.sessions[0]).not.toHaveProperty("hour");
  });

  it("resolves a missing kind, defaults a missing outcome to unknown, and bounds + redacts the command", () => {
    const secret = "ghp_" + "a".repeat(36);
    const call: ToolCallRecord = { name: "run_in_terminal", argsSummary: `echo ${secret} ${"x".repeat(400)}` };
    const rows = buildInsightRows([providerSessions([analyzeSession("s1", undefined, [turn(0, [call])])])]);
    const [row] = rows.toolCalls;
    expect(row).toMatchObject({ kind: "shell", status: "unknown" });
    expect(row?.command).not.toContain(secret);
    expect(row?.command?.length).toBeLessThanOrEqual(200);
  });

  it("carries the failure category, timing and program", () => {
    const call: ToolCallRecord = {
      ...bash("rg foo", "error", "2026-10-10T09:16:00.000Z"),
      outcome: { status: "error", failureCategory: "command-not-found" },
      durationMs: 12,
    };
    const rows = buildInsightRows([providerSessions([analyzeSession("s1", undefined, [turn(0, [call])])])]);
    expect(rows.toolCalls[0]).toMatchObject({
      program: "rg",
      status: "error",
      failureCategory: "command-not-found",
      startedAt: "2026-10-10T09:16:00.000Z",
      durationMs: 12,
    });
  });

  describe("cost figures (step 15.6)", () => {
    const priced = (amount: number): CostFigure => ({ known: true, amount, currency: "USD", basis: "priced", priceVersionIds: ["v"] });
    // Prices turn 0 at $2, leaves turn 1 unknown; records what it was asked.
    const asked: { providerId: string; session: Session; turn: Turn }[] = [];
    const fakePricer: TurnPricer = {
      figuresFor: (providerId, session, turnValue) => {
        asked.push({ providerId, session, turn: turnValue });
        const base = new TurnCostFigureBuilder().figuresFor(providerId, session, turnValue, NOT_ATTRIBUTED);
        return { ...base, priced: turnValue.index === 0 ? priced(2) : { known: false, reason: "no price" } };
      },
    };

    it("puts billed, reported and priced figures on every turn row", () => {
      const rows = buildInsightRows([providerSessions([analyzeSession("s1", undefined, [turn(0), turn(1)])], "vscode")], fakeAttributor, fakePricer);
      expect(rows.turns.map((row) => row.cost?.priced)).toEqual([priced(2), { known: false, reason: "no price" }]);
      expect(rows.turns[0]!.cost?.billed).toEqual({ known: true, amount: 1, currency: "AI_CREDITS", basis: "billed" });
      expect(asked.at(-1)).toMatchObject({ providerId: "vscode", turn: { index: 1 } });
      for (const row of rows.turns) insightTurnRowSchema.parse(row);
    });

    it("sums the session row per basis with coverage: an unknown turn is not 0", () => {
      const rows = buildInsightRows([providerSessions([analyzeSession("s1", undefined, [turn(0), turn(1)])], "vscode")], fakeAttributor, fakePricer);
      expect(rows.sessions[0]!.cost?.priced).toMatchObject({ turns: 2, knownTurns: 1, usd: 2 });
      expect(rows.sessions[0]!.cost?.billed).toMatchObject({ turns: 2, knownTurns: 2 });
      insightSessionRowSchema.parse(rows.sessions[0]);
    });

    it("without a pricer, still carries billed and reported, and priced as unknown", () => {
      const rows = buildInsightRows([providerSessions([analyzeSession("s1", undefined, [turn(0)])], "vscode")]);
      expect(rows.turns[0]!.cost?.priced.known).toBe(false);
      expect(rows.turns[0]!.cost?.billed.known).toBe(true);
    });

    it("dates a turn by its own time, else its session's", () => {
      const own = { ...turn(0), startedAt: "2026-10-31T23:30:00.000Z" };
      const rows = buildInsightRows([providerSessions([analyzeSession("s1", "2026-10-30T10:00:00.000Z", [own, turn(1)])], "vscode")]);
      expect(rows.turns.map((row) => row.date)).toEqual(["2026-10-31", "2026-10-30"]);
    });

    // Step 15.11 (D6): the instant too, so statements bill in their time zone.
    it("gives each turn its time as an ISO instant, the same one its date comes from", () => {
      const own = { ...turn(0), startedAt: "2026-10-31T23:30:00+00:00" };
      const rows = buildInsightRows([providerSessions([analyzeSession("s1", "2026-10-30T10:00:00.000Z", [own, turn(1)])], "vscode")]);
      expect(rows.turns.map((row) => row.at)).toEqual(["2026-10-31T23:30:00.000Z", "2026-10-30T10:00:00.000Z"]);
    });
  });
});
