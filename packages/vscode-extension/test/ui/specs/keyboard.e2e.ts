// Manual check 1.7 (docs/plans/vscode-extension-manual-checks.md): keyboard
// only, in a real VS Code (step 10.16). No mouse calls anywhere in this file;
// the one workbench command used to cross from the side bar into the editor
// is the one the plan names (focusActiveEditorGroup).
import { browser, expect } from "@wdio/globals";
import { INTERNAL_COMMAND_IDS } from "../../../src/diagnostics/test-hooks.js";
import type { RpcTraceEntry } from "../../../src/diagnostics/rpc-trace.js";
import { AnalyzerPanel } from "../support/analyzer-panel.js";
import { focusedElement, press, tabUntil } from "../support/keyboard.js";
import { parseUiFixture, UI_FIXTURE_ENV } from "../support/ui-fixture-env.mts";
import { wdioVscodeHost as host } from "../support/vscode-host.js";

const fixture = parseUiFixture(process.env[UI_FIXTURE_ENV]);
const panel = new AnalyzerPanel(host);

suite("Keyboard only (check 1.7)", () => {
  suiteSetup(async () => {
    await host.waitForExtension();
    await panel.reset();
  });

  test("1.7 reach the side bar, open a session, tab through the panel with focus always visible", async () => {
    // The Sessions view by command; then Down/Enter on its tree.
    await host.command("aiCreditsAnalyzer.refreshSessions");
    await host.command("aiCreditsAnalyzer.sessions.focus");
    // Down until the focused row is the usage session's, then Enter.
    let reached = false;
    for (let presses = 0; presses < 6 && !reached; presses++) {
      await press("ArrowDown");
      await browser.pause(150);
      const label = await browser.execute(() => (document.querySelector(".monaco-list-row.focused") as HTMLElement | null)?.getAttribute("aria-label") ?? "");
      reached = label.startsWith(fixture.usageSessionTitle);
    }
    expect(reached).toBe(true);
    await press("Enter");

    await browser.waitUntil(
      async () => (await host.hook<RpcTraceEntry[]>(INTERNAL_COMMAND_IDS.rpcTrace)).some((entry) => entry.method === "getSession" && entry.ok),
      { timeout: 30_000, timeoutMsg: "Enter on a session row did not open it in the panel" },
    );

    // Focus moves into the panel by the workbench command, then by Tab only.
    await panel.inside((view) => view.waitForTurnRows(1));
    await panel.focusIntoPanel();
    await panel.inside(async (view) => {
      await view.focusPanel();

      const visited = await tabUntil((element) => element.name === "Columns");
      expect(visited.length).toBeGreaterThan(1);

      // Enter opens the column chooser, Escape closes it with focus back on Columns.
      await press("Enter");
      expect((await focusedElement()).ariaExpanded).toBe("true");
      await press("Escape");
      const afterEscape = await focusedElement();
      expect(afterEscape.name).toBe("Columns");
      expect(afterEscape.ariaExpanded).toBe("false");
    });
  });

  test("1.7 the system prompt diagram moves with arrow keys, and View as table toggles aria-pressed", async () => {
    await panel.reset();
    await panel.openSession(fixture.usageSessionId);
    await panel.inside((view) => view.waitForTurnRows(1));
    await panel.focusIntoPanel();

    await panel.inside(async (view) => {
      await view.focusPanel();

      // The System prompt tab is a radio group: reach it, and choose with the arrow keys.
      await tabUntil((element) => element.tag === "INPUT" && element.name === "Explanation");
      await press("ArrowRight");
      await view.waitForText("System prompt breakdown");

      await tabUntil((element) => element.name === "Open system prompt inspector");
      await press("Enter");
      await view.waitForText("System prompt inspector");

      // The Pretty / Raw / Icicle radio group: arrow keys choose Icicle.
      await tabUntil((element) => element.tag === "INPUT" && element.name === "Pretty");
      await press("ArrowRight");
      await press("ArrowRight");
      expect((await focusedElement()).name).toBe("Icicle");

      // Into the diagram's first cell, then an arrow key moves to another cell.
      const first = await tabUntil((element) => element.role === "button" && element.name.includes("chars"));
      const before = first[first.length - 1]!.name;
      let moved = before;
      for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft"]) {
        await press(key);
        moved = (await focusedElement()).name;
        if (moved !== before) break;
      }
      expect(moved).not.toBe(before);

      // View as table: Enter toggles aria-pressed.
      const toggle = await tabUntil((element) => element.name === "View as table");
      expect(toggle[toggle.length - 1]!.ariaPressed).toBe("false");
      await press("Enter");
      expect((await focusedElement()).ariaPressed).toBe("true");
    });
  });
});
