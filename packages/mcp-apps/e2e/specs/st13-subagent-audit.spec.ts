// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { enrichedFinding, findingsResult } from "../../src/views/findings/fixtures.js";
import { subagentAudit } from "../../src/view-models/audit-fixtures.js";
import { modelTurnsIn, toolCallsIn } from "../support/call-log.js";
import { expect, inEachClaudeSet, test, VSCODE_SETS } from "../support/host-fixture.js";

// ST13 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/subagent-tool-audit.md §5.7, boards U4AuditView and
// FindingRow): U4 splits a session audit's calls by agent and lists the
// subagent runs; U3 names the run on a finding. The fixture home has no
// subagent run, so the fake host answers with the shapes the tools return
// (the view models' own fixtures, parsed with the domain schemas). Claude
// light and dark, and VS Code light, dark and High Contrast, with axe; 320
// and 640 px.

const ARGS = { sessionId: "9d41b7e2", provider: "vscode" };
const REVIEW_REASON = "The subagent log runSubagent-Review this turn started is missing, so its tool calls are unknown.";

function define(): void {
  test("U4: sub-line, the Agent filter, the runs list with an unread reason and a flag, canceled; axe clean; no tool call or message", async ({ host }) => {
    const audit = subagentAudit({ unread: true, flagged: true });
    audit.totals = { ...audit.totals, canceled: 2 };
    const view = await host.showResult("get_session_audit", audit, { args: ARGS });
    const u4 = view.audit;

    await expect(u4.tile("Tool calls")).toContainText("214");
    await expect(u4.tile("Tool calls")).toContainText("incl. 83 calls from 3 of 5 subagent runs");
    await expect(view.content.getByText("2 calls canceled by the user: not counted as failures or unknown.")).toBeVisible();
    await expect(u4.callsByAgent()).toContainText("Main agent");
    await expect(u4.callsByAgent()).toContainText("131");
    await expect(u4.callsByAgent()).toContainText("83");

    await expect(u4.runs()).toHaveCount(5);
    const review = u4.runs().filter({ hasText: "runSubagent-Review" });
    await expect(review).toContainText("calls unknown");
    await expect(review).toContainText(REVIEW_REASON);
    await expect(review).not.toContainText(/\b0 calls/);
    await expect(u4.runs().filter({ hasText: "Agent-Plan" })).toContainText("flagged: The call that started this run is missing from the log.");
    await expect(view.content.getByText("2 subagent runs not read; their calls aren't counted.")).toBeVisible();
    expect(await view.axeViolations()).toEqual([]);

    await u4.chooseAgent("Main agent");
    await expect(u4.tile("Tool calls")).toContainText("131");
    await expect(u4.tile("Tool calls")).toContainText("main agent only");
    await expect(view.content.getByText("Failure categories, recovery cost, retries and tools count all agents.")).toBeVisible();
    await expect(u4.runs()).toHaveCount(0);
    expect(await view.axeViolations()).toEqual([]);

    await u4.chooseAgent("Subagents");
    await expect(u4.tile("Tool calls")).toContainText("83");
    await expect(u4.runs()).toHaveCount(5);
    await u4.chooseAgent("All");
    await expect(u4.tile("Tool calls")).toContainText("214");

    expect(modelTurnsIn(host.calls)).toEqual([]);
    expect(toolCallsIn(host.calls)).toEqual([]);
  });

  test("U4: a run placed by time says so as text, and the others do not; axe clean", async ({ host }) => {
    const view = await host.showResult("get_session_audit", subagentAudit({ unread: true, byTime: true }), { args: ARGS });
    const u4 = view.audit;

    await expect(u4.runs()).toHaveCount(5);
    await expect(u4.runs().filter({ hasText: "matched by time" })).toHaveCount(1);
    await expect(u4.runs().filter({ hasText: "matched by time" })).toContainText("turn 9");
    await expect(u4.runs().filter({ hasText: "runSubagent-Review" })).not.toContainText("matched by time");
    expect(await view.axeViolations()).toEqual([]);
  });

  test("U4 at 640 and 320 px: nothing scrolls sideways; the runs, the filter and the reason stay readable; axe clean", async ({ host }) => {
    for (const width of [640, 320]) {
      const view = await host.showResult("get_session_audit", subagentAudit({ unread: true, nested: true }), { args: ARGS, width });
      await expect(view.audit.runs().first()).toBeVisible();
      await expect(view.audit.agentFilter()).toBeVisible();
      await expect(view.audit.runs().filter({ hasText: "searchSubagent" })).toContainText("calls unknown");
      expect(await view.width()).toBeLessThanOrEqual(width);
      expect(await view.scrollsSideways(), `${width} px`).toBe(false);
      expect(await view.axeViolations()).toEqual([]);
    }
  });

  test("U3: a finding names the subagent run and its turn; the main agent's finding does not; axe clean", async ({ host }) => {
    const result = findingsResult([
      enrichedFinding({ key: "a", turnIndex: 4, origin: { kind: "subagent", runId: "run-explore-1", label: "Agent-Explore", depth: 1 } }),
      enrichedFinding({ key: "b", title: "Main agent finding", turnIndex: 2 }),
    ]);
    const view = await host.showResult("list_findings", result, { args: {} });
    const u3 = view.findings;

    await expect(u3.runNote("by subagent run Agent-Explore (turn 4)").first()).toBeVisible();
    await expect(u3.rows().nth(1)).not.toContainText("by subagent run");
    expect(await view.axeViolations()).toEqual([]);

    const narrow = await host.showResult("list_findings", result, { args: {}, width: 320 });
    await expect(narrow.findings.runNote("by subagent run Agent-Explore (turn 4)").first()).toBeVisible();
    expect(await narrow.scrollsSideways()).toBe(false);
    expect(await narrow.axeViolations()).toEqual([]);
  });
}

inEachClaudeSet(define);

for (const set of VSCODE_SETS) {
  test.describe(`in VS Code, ${set.name ?? set.theme}`, () => {
    test.use({ hostKind: "vscode", hostSet: set });
    define();
  });
}
