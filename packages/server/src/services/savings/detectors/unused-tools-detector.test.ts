// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { savingsActionText, savingsOpportunitySchema } from "@agent-cost-analyzer/domain";
import { COPILOT, savingsInput, session, sessionInput, tool, withRounds } from "../../../test-support/savings-fakes.js";
import { UnusedToolsDetector } from "./unused-tools-detector.js";

// Phase 16 SR5 (docs/plans/savings-report.md §4 O1, §6): tools loaded in a
// session and invoked in none of the window's sessions. Golden figures are
// hand-computed from the bundled price book, claude-sonnet-5 from 2026-10-01
// (USD per million tokens: input 2, cache read 0.2; GitHub Copilot at 1 AI
// Credit = $0.01 is 200 and 20 credits) over a 30-day window (30/7 weeks).
const WEEKS = 30 / 7;
const detector = new UnusedToolsDetector();

// Linear's server: 800 tokens per request (500 + 300), loaded in two
// sessions of 10 and 20 requests, never invoked. Bash is invoked in one.
const linear = (invoked: number[] = []) => [tool("mcp__linear__get_issue", 500, invoked), tool("mcp__linear__save_issue", 300)];
const s1 = session("s1", { turns: withRounds([4, 6]), toolInventory: [...linear(), tool("Bash", 200, [0])] });
const s2 = session("s2", { turns: withRounds([20]), toolInventory: [...linear(), tool("Bash", 200)] });

describe("UnusedToolsDetector: MCP servers", () => {
  it("groups an exact mcp__server__tool name by server and prices tokens × requests as a range", () => {
    const { opportunities, notAnalysed } = detector.detect(savingsInput([sessionInput(s1), sessionInput(s2)]));

    expect(notAnalysed).toEqual([]);
    expect(opportunities).toHaveLength(1);
    const [linearOpportunity] = opportunities;
    expect(linearOpportunity).toMatchObject({
      key: "unused-tools:linear:USD",
      kind: "unused-tools",
      subject: "linear",
      inferred: false,
      sessions: [
        { providerId: "claude-code", sessionId: "s1" },
        { providerId: "claude-code", sessionId: "s2" },
      ],
      evidence: { sessions: 2, requests: 30, tokens: { known: true, value: 800, estimated: true }, occurrences: null },
      actionParams: { group: "linear", tools: 2, tokens: 800, sessions: 2, days: 30 },
      coverage: { sessionsInWindow: 2, sessionsAnalysed: 2, notAnalysed: [] },
    });
    // 800 × 30 requests = 24,000 tokens: 24,000 × 0.2 / 1e6 and × 2 / 1e6.
    const window = linearOpportunity!.perWindow;
    expect(window).toMatchObject({ known: true, currency: "USD", basis: "priced", label: "range", priceVersionIds: ["anthropic-api:claude-sonnet-5:2026-10-01"] });
    if (window.known) {
      expect(window.low).toBeCloseTo(0.0048, 9);
      expect(window.high).toBeCloseTo(0.048, 9);
    }
    const week = linearOpportunity!.perWeek;
    if (week.known) {
      expect(week.low).toBeCloseTo(0.0048 / WEEKS, 9);
      expect(week.high).toBeCloseTo(0.048 / WEEKS, 9);
    }
    expect(savingsOpportunitySchema.safeParse(linearOpportunity).success).toBe(true);
    expect(() => savingsActionText("unused-tools", linearOpportunity!.actionParams)).not.toThrow();
  });

  it("does not report a server when any of its tools ran in any session", () => {
    const used = session("s3", { toolInventory: linear([0]) });

    const { opportunities } = detector.detect(savingsInput([sessionInput(s1), sessionInput(s2), sessionInput(used)]));

    expect(opportunities.filter((opportunity) => opportunity.subject === "linear")).toEqual([]);
  });

  it("reports a built-in tool that was loaded and never invoked on its own", () => {
    const { opportunities } = detector.detect(savingsInput([sessionInput(s2)]));

    expect(opportunities.map((opportunity) => opportunity.subject)).toEqual(["Bash", "linear"]);
    expect(opportunities[0]).toMatchObject({ inferred: false, actionParams: { group: "Bash", tools: 1, tokens: 200 } });
  });

  it("ignores a tool that is defined but not loaded", () => {
    const hidden = session("s4", { turns: withRounds([3]), toolInventory: [tool("mcp__slack__post", 400, [], false)] });

    expect(detector.detect(savingsInput([sessionInput(hidden)])).opportunities).toEqual([]);
  });
});

describe("UnusedToolsDetector: Copilot", () => {
  const github = (invoked: number[] = []) => [tool("mcp_github_get_issue", 100, invoked), tool("mcp_github_list_prs", 50)];
  const cp = session("cp", { providerId: "vscode", model: "claude-sonnet-5", turns: withRounds([5]), toolInventory: github() });

  it("groups an mcp_ name by its first segment and marks it inferred; prices in AI Credits", () => {
    const { opportunities } = detector.detect(savingsInput([sessionInput(cp, { channel: COPILOT })]));

    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toMatchObject({ key: "unused-tools:github:AI_CREDITS", subject: "github", inferred: true, evidence: { requests: 5 } });
    // 150 tokens × 5 requests = 750: × 20 and × 200 credits per million.
    const window = opportunities[0]!.perWindow;
    expect(window).toMatchObject({ known: true, currency: "AI_CREDITS", label: "range" });
    if (window.known) {
      expect(window.low).toBeCloseTo(0.015, 9);
      expect(window.high).toBeCloseTo(0.15, 9);
    }
  });

  it("uses the request trace's count and models when the session has one", () => {
    const trace = {
      sessionId: "cp",
      providerId: "vscode",
      harness: "copilot-local",
      notTraced: [],
      requests: [0, 1, 2].map((index) => ({ index, turnIndex: 0, startedAt: `2026-10-15T12:0${index}:00Z`, model: "claude-sonnet-5", uncachedInput: 10, cacheRead: 0, cacheWrite: null, output: 1 })),
    } as const;

    const { opportunities } = detector.detect(savingsInput([sessionInput(cp, { channel: COPILOT, trace: trace as never })]));

    expect(opportunities[0]!.evidence.requests).toBe(3);
  });
});

describe("UnusedToolsDetector: Not analysed (never 0)", () => {
  const agentHost = session("ah", { providerId: "vscode", copilotHarness: "agent-host" });
  const noInventory = session("ni", { providerId: "pi-agent" });
  const noRounds = session("nr", { turns: [{ ...withRounds([1])[0]!, usage: { ...withRounds([1])[0]!.usage, roundsCount: undefined as never } }], toolInventory: linear() });
  const unknownChannel = session("uc", { turns: withRounds([2]), toolInventory: linear() });

  it("lists sessions with no inventory, no request count or an unknown channel, with reasons, per provider", () => {
    const { opportunities, notAnalysed } = detector.detect(
      savingsInput([
        sessionInput(agentHost, { channel: COPILOT }),
        sessionInput(noInventory),
        sessionInput(noRounds),
        sessionInput(unknownChannel, { channel: { known: false, reason: "No channel." } }),
        sessionInput(s1),
      ]),
    );

    expect(notAnalysed).toEqual([
      { kind: "unused-tools", providerId: "claude-code", reason: "No channel.", sessions: 1 },
      { kind: "unused-tools", providerId: "claude-code", reason: "The log records no request count for this session, so tool tokens can't be multiplied by requests.", sessions: 1 },
      { kind: "unused-tools", providerId: "pi-agent", reason: "The log records no tool inventory for this session.", sessions: 1 },
      { kind: "unused-tools", providerId: "vscode", reason: "VS Code's Agent Host records the total tool-definition tokens only, not each tool, so unused tools can't be found.", sessions: 1 },
    ]);
    // The analysable session still yields its opportunity, with honest coverage.
    expect(opportunities.map((opportunity) => opportunity.subject)).toEqual(["linear"]);
    expect(opportunities[0]!.coverage).toMatchObject({ sessionsInWindow: 5, sessionsAnalysed: 1 });
    expect(opportunities[0]!.coverage.notAnalysed).toHaveLength(4);
  });

  it("lists a group whose tokens are unknown under Not analysed with the reason, never as 0 tokens", () => {
    const broken = session("br", { turns: withRounds([3]), toolInventory: [tool("mcp__jira__find", null)] });

    const { opportunities, notAnalysed } = detector.detect(savingsInput([sessionInput(broken)]));

    expect(opportunities).toEqual([]);
    expect(notAnalysed).toEqual([{ kind: "unused-tools", providerId: "claude-code", reason: "The tools file is missing.", sessions: 1 }]);
  });

  it("gives an unknown amount with the price book's reason when a model has no price", () => {
    const odd = session("odd", { model: "no-such-model", turns: withRounds([3], "no-such-model"), toolInventory: linear() });

    const { opportunities } = detector.detect(savingsInput([sessionInput(odd)]));

    expect(opportunities[0]).toMatchObject({
      perWindow: { known: false, reason: expect.any(String) },
      perWeek: { known: false },
      evidence: { tokens: { known: true, value: 800 } },
      coverage: { sessionsAnalysed: 0, notAnalysed: [{ sessions: 1 }] },
    });
  });

  it("is empty for no sessions", () => {
    expect(detector.detect(savingsInput([]))).toEqual({ opportunities: [], notAnalysed: [] });
  });
});

describe("UnusedToolsDetector: golden report", () => {
  it("over a multi-session, multi-provider window (update with `vitest -u` after checking the diff by hand)", async () => {
    const copilot = session("cp", {
      providerId: "vscode",
      turns: withRounds([5]),
      toolInventory: [tool("mcp_github_get_issue", 100), tool("mcp_github_list_prs", 50), tool("read_file", 90, [0])],
    });
    const agentHost = session("ah", { providerId: "vscode", copilotHarness: "agent-host" });
    const result = detector.detect(
      savingsInput([sessionInput(s1), sessionInput(s2), sessionInput(copilot, { channel: COPILOT }), sessionInput(agentHost, { channel: COPILOT }), sessionInput(session("pi", { providerId: "pi-agent" }))]),
    );

    await expect(`${JSON.stringify(result, null, 2)}\n`).toMatchFileSnapshot("../__golden__/savings-unused-tools-report.json");
  });
});
