// Manual checks 1.8, 1.9 and 1.10 (docs/plans/vscode-extension-manual-checks.md),
// driven in a real VS Code (step 10.16). Each test title cites its check.
import { browser, expect } from "@wdio/globals";
import { judgeProbe, type Probe } from "../../../scripts/ui-check/judge.mts";
import { PROBE_SCRIPT } from "../../../scripts/ui-check/probe.mts";
import { layoutFor } from "../../../../web/src/lib/layout.js";
import { AnalyzerPanel, type PanelView } from "../support/analyzer-panel.js";
import { hasVisibleFocusIndicator } from "../support/focus-probe.js";
import { isWithinTolerance, nextGroupFraction } from "../support/panel-width.js";
import { saveScreenshot } from "../support/screenshots.js";
import { parseUiFixture, UI_FIXTURE_ENV } from "../support/ui-fixture-env.mts";
import { wdioVscodeHost as host } from "../support/vscode-host.js";

const fixture = parseUiFixture(process.env[UI_FIXTURE_ENV]);
const panel = new AnalyzerPanel(host);
const THEME_SETTING = "workbench.colorTheme";

async function useTheme(name: string, bodyClass: string): Promise<void> {
  await host.setSetting(THEME_SETTING, name);
  await panel.inside(async (view) => {
    await browser.waitUntil(async () => (await view.bodyClass()).split(" ").includes(bodyClass), {
      timeout: 30_000,
      timeoutMsg: `the panel did not switch to ${bodyClass} for ${name}`,
    });
  });
}

async function openUsageSession(): Promise<void> {
  await panel.reset();
  await panel.openSession(fixture.usageSessionId);
  await panel.inside((view) => view.waitForTurnRows(1));
}

async function probe(view: PanelView): Promise<Probe> {
  void view;
  return (await browser.execute(`return ${PROBE_SCRIPT}`)) as Probe;
}

suite("Themes and font (checks 1.8, 1.10)", () => {
  suiteSetup(async () => {
    await host.waitForExtension();
    await openUsageSession();
  });

  suiteTeardown(async () => {
    await host.setSetting(THEME_SETTING, undefined);
    await host.setSetting("editor.fontSize", undefined);
  });

  for (const [theme, bodyClass] of [
    ["Default High Contrast", "vscode-high-contrast"],
    ["Default High Contrast Light", "vscode-high-contrast-light"],
  ] as const) {
    test(`1.8 ${theme}: every text reaches WCAG AA on its ground, and selection and focus are visible`, async () => {
      await useTheme(theme, bodyClass);
      await panel.focusIntoPanel();

      const findings = await panel.inside(async (view) => {
        const probed = await probe(view);
        // Guards against a vacuous pass: the page has real text to judge.
        expect(probed.texts.length).toBeGreaterThan(10);
        const result = judgeProbe(probed);
        // Focus: a focused button must draw an outline or shadow.
        await view.focusPanel();
        await browser.keys(["Tab"]);
        const focusStyle = await browser.execute(() => {
          const element = document.activeElement as Element;
          const style = getComputedStyle(element);
          return { tag: element.tagName, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, boxShadow: style.boxShadow };
        });
        console.log(`1.8 focus after Tab: ${JSON.stringify(focusStyle)}`);
        expect(hasVisibleFocusIndicator(focusStyle)).toBe(true);
        // Selection: the selected turn row differs from the plain ground.
        const selectedDiffers = await browser.execute(() => {
          const row = document.querySelector("tbody tr[aria-selected='true']") as HTMLElement | null;
          if (!row) return false;
          const style = getComputedStyle(row);
          return (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) || style.backgroundColor !== getComputedStyle(document.body).backgroundColor;
        });
        expect(selectedDiffers).toBe(true);
        return result;
      });

      await saveScreenshot(`1.8-${bodyClass}`);
      expect(findings).toEqual([]);
    });
  }

  test("1.10 a light theme changes the panel's body class and editor background", async () => {
    await useTheme("Default Dark Modern", "vscode-dark");
    const dark = await panel.inside((view) => view.cssVariable("--vscode-editor-background"));

    await useTheme("Default Light Modern", "vscode-light");
    const light = await panel.inside((view) => view.cssVariable("--vscode-editor-background"));

    expect(dark).not.toBe("");
    expect(light).not.toBe("");
    expect(light).not.toBe(dark);
    await saveScreenshot("1.10-light");
  });

  // Finding for the owner (plan section 5, Q4): the panel sizes its text from
  // --vscode-font-size (the workbench font), not --vscode-editor-font-size, so
  // `editor.fontSize` reaches the webview as a variable that nothing uses.
  // This test pins that behaviour; change it with the owner's decision.
  test("1.10 editor.fontSize reaches the webview as --vscode-editor-font-size, but the panel text follows the workbench font", async () => {
    await host.setSetting("editor.fontSize", 20);

    await panel.inside(async (view) => {
      await browser.waitUntil(async () => (await view.cssVariable("--vscode-editor-font-size")) === "20px", {
        timeout: 30_000,
        timeoutMsg: "--vscode-editor-font-size did not become 20px",
      });
      const workbenchFont = await view.cssVariable("--vscode-font-size");
      const bodyFont = await browser.execute(() => getComputedStyle(document.body).fontSize);
      expect(bodyFont).toBe(workbenchFont);
    });
  });
});

suite("Narrow panel (check 1.9)", () => {
  suiteSetup(async () => {
    await host.waitForExtension();
    await openUsageSession();
    await host.command("workbench.action.closeSidebar");
  });

  suiteTeardown(async () => {
    await host.command("vscode.setEditorLayout", { orientation: 0, groups: [{}] });
  });

  // The window can't be resized through the driver (Electron has no window
  // rect), and VS Code's minimum window is about 400 px, so the panel's width
  // is set through the editor layout: its group takes a fraction of the editor
  // area, nudged until the webview measures the target.
  async function resizeSoPanelIs(target: number): Promise<number> {
    let fraction = 1;
    await host.command("vscode.setEditorLayout", { orientation: 0, groups: [{}] });
    await browser.pause(500);
    let measured = await panel.inside((view) => view.width());
    for (let attempt = 0; attempt < 6 && !isWithinTolerance(measured, target); attempt++) {
      fraction = nextGroupFraction(fraction, measured, target);
      await host.command("vscode.setEditorLayout", { orientation: 0, groups: [{ size: fraction }, { size: 1 - fraction }] });
      await browser.pause(500);
      measured = await panel.inside((view) => view.width());
    }
    return measured;
  }

  for (const target of [640, 360]) {
    test(`1.9 at about ${target} px the layout switches and the page does not scroll sideways`, async () => {
      const width = await resizeSoPanelIs(target);
      console.log(`1.9 panel is ${width} px wide`);

      await panel.inside(async (view) => {
        const expected = layoutFor(width, { listColumn: false });
        await browser.waitUntil(
          async () => {
            await view.requestFrame();
            return (await view.layout()) === expected;
          },
          { timeout: 30_000, interval: 500, timeoutMsg: `layout did not become ${expected}` },
        );
        // The Copilot Chat setup banner is checked on its own below.
        await view.dismissConfigBanner();
        await view.requestFrame();
        const { scrollWidth, clientWidth } = await view.horizontalOverflow();
        if (scrollWidth > clientWidth) console.log(`1.9 overflow ${JSON.stringify((await probe(view)).overflowing)}`);
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
        if (expected === "narrow") {
          // The centre views become a <select> (mock-up 4), not the radio group.
          expect(await browser.execute(() => document.querySelectorAll("select").length)).toBeGreaterThan(0);
          expect(await browser.execute(() => document.querySelectorAll("input[name='center-view']").length)).toBe(0);
        }
      });
      await saveScreenshot(`1.9-${target}`);
    });
  }

  // Found by this automation: with Copilot Chat missing (the baseline here)
  // the config warning banner was wider than a 360 px panel. A fresh panel
  // shows it, so the check runs before anything dismisses it.
  for (const target of [360, 320]) {
    test(`1.9 the config warning banner fits a ${target} px panel`, async () => {
      await openUsageSession();
      const width = await resizeSoPanelIs(target);
      await panel.inside(async (view) => {
        await view.waitForText("Dismiss");
        await view.requestFrame();
        const { scrollWidth, clientWidth } = await view.horizontalOverflow();
        if (scrollWidth > clientWidth) console.log(`1.9 banner overflow at ${width} px ${JSON.stringify((await probe(view)).overflowing)}`);
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      });
      await saveScreenshot(`1.9-banner-${target}`);
    });
  }
});
