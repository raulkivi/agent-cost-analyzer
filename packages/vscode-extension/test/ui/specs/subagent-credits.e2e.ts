// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Step 10.19 (SA15, plan section 7): the AI Credits of classic Copilot Chat
// subagent runs, in a real VS Code. The two seeded classic sessions come from
// the server's subagent fixtures: one with a runSubagent ("Explore", 1.10) and
// a searchSubagent run (0.00, D8), one whose child log is missing. The status
// bar total is checked with the other status bar checks, in the launch where
// Copilot Chat is enabled (copilot-available.e2e.ts).
import { browser, expect } from "@wdio/globals";
import { INTERNAL_COMMAND_IDS } from "../../../src/diagnostics/test-hooks.js";
import type { SessionNode, SessionsTreeNode } from "../../../src/sidebar/sessions-tree-model.js";
import { DANGLING_SESSION, SUBAGENT_SESSION } from "../../../scripts/ui-automation/ui-fixture.mts";
import { AnalyzerPanel } from "../support/analyzer-panel.js";
import { wdioVscodeHost as host } from "../support/vscode-host.js";

const panel = new AnalyzerPanel(host);

async function sessionNode(sessionId: string): Promise<SessionNode> {
  await host.command("aiCreditsAnalyzer.refreshSessions");
  const tree = await host.hook<SessionsTreeNode[]>(INTERNAL_COMMAND_IDS.sessionsTree);
  const nodes = tree.flatMap((node) => (node.kind === "group" ? (node.children ?? []) : [node]));
  const found = nodes.find((node): node is SessionNode => node.kind === "session" && node.sessionId === sessionId);
  if (!found) throw new Error(`No Sessions view row for ${sessionId}`);
  return found;
}

suite("Classic subagent runs (step 10.19)", () => {
  suiteSetup(async () => {
    await host.waitForExtension();
    await panel.reset();
  });

  test("the Sessions view shows the folded total, and its tooltip the subagent line", async () => {
    const node = await sessionNode(SUBAGENT_SESSION.id);

    expect(node.description).toBe("5.10");
    expect(node.tooltip.split("\n")).toEqual(expect.arrayContaining(["5.10 AI Credits", "incl. 1.10 AI Credits from 2 subagent runs"]));
  });

  test("a session with a dangling child ref shows AI Credits unknown and the missing-log reason, never a figure", async () => {
    const node = await sessionNode(DANGLING_SESSION.id);

    expect(node.description).toBe("AI Credits unknown");
    expect(node.tooltip).toMatch(/AI Credits unknown: .*log .*missing/);
    expect(node.tooltip).not.toContain("0.00");
  });

  test("the panel's turn rows carry the marker with the tooltip text, and the Explanation panel lists each run", async () => {
    await panel.openSession(SUBAGENT_SESSION.id);

    await panel.inside(async (view) => {
      await view.waitForTurnRows(2);
      const markers = await view.subagentMarkers();
      expect(markers.map((marker) => marker.row)).toEqual([0, 1]);
      expect(markers.map((marker) => marker.label)).toEqual(["incl. 1.10 AI Credits from 1 subagent run", "incl. 0.00 AI Credits from 1 subagent run"]);
      expect(markers.map((marker) => marker.title)).toEqual(markers.map((marker) => marker.label));
      expect(markers.some((marker) => marker.unknown)).toBe(false);

      await view.selectTurn(0);
      await view.showTab("Explanation");
      await browser.waitUntil(async () => (await view.subagentBlock()) !== null, { timeout: 30_000, timeoutMsg: "the Explanation panel shows no subagent block for turn 1" });
      const first = (await view.subagentBlock())!;
      expect(first.runs).toHaveLength(1);
      expect(first.runs[0]).toMatch(/^Explore .*2 requests 1\.10 AI Credits$/);
      expect(first.totals).toBe("Main agent 2.00 Subagent runs 1.10 Turn 3.10");

      // D8: a run that recorded no AI Credits is listed at 0.00, not hidden.
      await view.selectTurn(1);
      await browser.waitUntil(async () => ((await view.subagentBlock())?.runs[0] ?? "").startsWith("searchSubagent"), { timeout: 30_000, timeoutMsg: "the Explanation panel did not switch to turn 2" });
      const second = (await view.subagentBlock())!;
      expect(second.runs[0]).toMatch(/^searchSubagent .*1 request 0\.00 AI Credits$/);
      expect(second.totals).toBe("Main agent 2.00 Subagent runs 0.00 Turn 2.00");
    });
  });

  test("the session with a dangling ref has the dashed unknown marker with the reason, and the block names the unread run", async () => {
    await panel.reset();
    await panel.openSession(DANGLING_SESSION.id);

    await panel.inside(async (view) => {
      await view.waitForTurnRows(1);
      const [marker] = await view.subagentMarkers();
      expect(marker?.unknown).toBe(true);
      expect(marker?.label).toMatch(/^AI Credits unknown: .*missing/);

      await view.selectTurn(0);
      await view.showTab("Explanation");
      await browser.waitUntil(async () => (await view.subagentBlock()) !== null, { timeout: 30_000, timeoutMsg: "the Explanation panel shows no subagent block" });
      const block = (await view.subagentBlock())!;
      expect(block.runs[0]).toMatch(/^Subagent run not read .*missing/);
      expect(block.totals).toContain("Turn unknown");
    });
  });
});
