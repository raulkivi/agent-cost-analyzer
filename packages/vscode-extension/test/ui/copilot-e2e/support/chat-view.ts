// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Page objects for the MCP App views in a real Copilot Chat (step 10.17 G4),
// in the vocabulary of the fake host's (packages/mcp-apps/e2e/support/view-frame.ts):
// specs read as the A24 and A16 checklists do and hold no selectors.
//
// Frame path (G4 spike, VS Code 1.145): workbench → `.webview-overlay-content
// > iframe.webview` (an overlay webview laid over the tool call's
// `.mcp-app-part > .mcp-app-webview` placeholder in the chat list, outside
// the chat's DOM) → `iframe#active-frame[title="MCP App"]` → the view's
// document ("Cost views"). ChatViews finds the overlay over a placeholder
// and enters it; ChatView reads and drives the view inside it.
// TDD exception: these run only against a real VS Code; the pure parts
// (view-overlay.mts, view-prompt.mts) are unit-tested.
import { browser } from "@wdio/globals";
import { hasVisibleFocusIndicator } from "../../support/focus-probe.js";
import { judgeProbe, type Probe } from "../../../../scripts/ui-check/judge.mts";
import { PROBE_SCRIPT } from "../../../../scripts/ui-check/probe.mts";
import { isWithinTolerance } from "../../support/panel-width.js";
import type { AnalyseRowState } from "./analyse-outcome.mts";
import { overlayOver, type Rect } from "./view-overlay.mts";

const PART = ".mcp-app-part";
const PLACEHOLDER = ".mcp-app-part .mcp-app-webview";
const OVERLAY = ".webview-overlay-content";
const CHAT_LIST = ".interactive-list";
const REQUEST = ".interactive-request";
const RESPONSE = ".interactive-response";
// Where a view is scrolled to: below the request VS Code pins at the top of the chat.
const TOP_MARGIN = 90;

// What a view shows, read in one go inside its frame.
export interface ViewSnapshot {
  kicker: string;
  title: string;
  // The line under the title (period, bucket, pricing).
  subtitle: string;
  // role=group names and text: basis tiles, KPI tiles, severity tiles.
  groups: { name: string; text: string }[];
  // role=table names (aria-label or caption).
  tables: string[];
  // role=img names: charts and the waterfall.
  images: string[];
  // Visible button names.
  buttons: string[];
  // Text of role=alert / role=status messages.
  alerts: string[];
  footer: string;
  text: string;
}

const SNAPSHOT_SCRIPT = `(() => {
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.closest('[hidden]'); };
  const name = (el) => (el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '').split(' ').map((id) => document.getElementById(id)?.textContent || '').join(' ') || el.querySelector('caption')?.textContent || '').trim();
  const all = (sel) => [...document.querySelectorAll(sel)].filter(shown);
  const text = (sel) => (document.querySelector(sel)?.textContent || '').trim();
  return {
    kicker: text('.view-kicker .card-kicker'),
    title: text('h1'),
    subtitle: (document.querySelector('h1')?.nextElementSibling?.textContent || '').trim(),
    groups: all('[role="group"]').map((el) => ({ name: name(el), text: el.innerText.trim() })).filter((g) => g.name),
    tables: all('table, [role="table"]').map(name).filter(Boolean),
    images: all('[role="img"]').map(name).filter(Boolean),
    buttons: all('button').map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim()),
    alerts: all('[role="alert"], [role="status"]').map((el) => el.textContent.trim()),
    footer: text('.view-footer-note'),
    text: document.body.innerText,
  };
})()`;

// Inside one view's frame (after ChatViews.enter).
export class ChatView {
  async snapshot(): Promise<ViewSnapshot> {
    return (await browser.execute(`return ${SNAPSHOT_SCRIPT}`)) as ViewSnapshot;
  }

  async waitForTitle(title: string | RegExp, timeout = 30_000): Promise<void> {
    await browser.waitUntil(
      async () => {
        const current = (await this.snapshot()).title;
        return typeof title === "string" ? current === title : title.test(current);
      },
      { timeout, timeoutMsg: `the view's title did not become ${String(title)}` },
    );
  }

  // A button by its accessible name, as a user clicks it.
  async click(name: string): Promise<void> {
    await this.press(await this.button(name));
  }

  // A real click; where VS Code lays another view's webview over the point
  // (overlays stack outside the chat's DOM), the element's own click.
  private async press(element: WebdriverIO.Element): Promise<void> {
    await element.scrollIntoView({ block: "center" });
    try {
      await element.click();
    } catch (error) {
      if (!/intercepted|not clickable/i.test(String(error))) throw error;
      console.log("[copilot-e2e] a webview lay over the click point; clicked the element itself");
      await browser.execute((target: HTMLElement) => target.click(), element as unknown as HTMLElement);
    }
  }

  private async button(name: string): Promise<WebdriverIO.Element> {
    return this.findByName("button", name);
  }

  // The first element matching `selector` whose accessible name (aria-label,
  // else its text) is `name`.
  private async findByName(selector: string, name: string): Promise<WebdriverIO.Element> {
    for (const element of await browser.$$(selector).getElements()) {
      const label = (await element.getAttribute("aria-label")) ?? (await element.getProperty("textContent")) ?? "";
      if (String(label).trim() === name) return element;
    }
    throw new Error(`The view has no ${selector} "${name}"`);
  }

  // Tabs from the view's first control until a button has focus. When Tab
  // leaves the view (past its last control), focus goes back to its first
  // control, as tabTo does: a view whose only button is its first control
  // (U12's replay, U4's rollup: View as table) is reached on the way round.
  async tabToAButton(limit = 40): Promise<void> {
    await this.focusFirstControl();
    for (let presses = 0; presses < limit; presses++) {
      await browser.keys(["Tab"]);
      if (!(await browser.execute(() => document.hasFocus()))) await this.focusFirstControl();
      if (await browser.execute(() => document.activeElement?.tagName === "BUTTON")) return;
    }
    throw new Error(`Tab reached no button in the view in ${limit} presses`);
  }

  // Focus on the view's first control: a click on the title gives the frame
  // focus (a click can land on another view's webview, see press, so the
  // control itself is then focused by script).
  private async focusFirstControl(): Promise<void> {
    if (!(await browser.execute(() => document.hasFocus()))) {
      await (await browser.$("h1")).click().catch(() => undefined);
    }
    await browser.execute(() => {
      window.focus();
      (document.querySelector("button, a[href], input, select, [tabindex]:not([tabindex='-1'])") as HTMLElement | null)?.focus();
    });
  }

  async focusedControl(): Promise<string> {
    return browser.execute(() => {
      const active = document.activeElement;
      return (active?.getAttribute("aria-label") ?? active?.textContent ?? "").trim();
    });
  }

  async focusRingVisible(): Promise<boolean> {
    const style = await browser.execute(() => {
      const element = document.activeElement as Element;
      const computed = getComputedStyle(element);
      return { tag: element.tagName, outlineStyle: computed.outlineStyle, outlineWidth: computed.outlineWidth, boxShadow: computed.boxShadow };
    });
    return style.tag !== "BODY" && hasVisibleFocusIndicator(style);
  }

  // Tabs from where focus is until `name` has focus.
  // Keys reach the view only while its frame has focus; when Tab leaves the
  // view (past its last control), focus goes back to its first control, as
  // a keyboard user cycles through it.
  async tabTo(name: string, limit = 80): Promise<void> {
    if (!(await browser.execute(() => document.hasFocus()))) await this.focusFirstControl();
    if ((await this.focusedControl()) === name) return;
    for (let presses = 0; presses < limit; presses++) {
      await browser.keys(["Tab"]);
      if (!(await browser.execute(() => document.hasFocus()))) {
        await this.focusFirstControl();
      }
      if ((await this.focusedControl()) === name) return;
    }
    throw new Error(`Tab did not reach "${name}" in ${limit} presses`);
  }

  async pressEnter(): Promise<void> {
    await browser.keys(["Enter"]);
  }

  async scrollsSideways(): Promise<boolean> {
    return browser.execute(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  }

  async width(): Promise<number> {
    return browser.execute(() => document.documentElement.clientWidth);
  }

  // VS Code's theme as the view sees it: the webview's body classes
  // (vscode-light, vscode-dark, vscode-high-contrast, vscode-high-contrast-light)
  // and the scheme the host context set on <html data-theme>.
  async theme(): Promise<{ bodyClasses: string[]; scheme: string }> {
    return browser.execute(() => ({ bodyClasses: document.body.className.split(/\s+/).filter(Boolean), scheme: document.documentElement.dataset.theme ?? "" }));
  }

  // The column headers of every table in the view.
  async columnHeaders(): Promise<string[]> {
    return browser.execute(() =>
      Array.from(document.querySelectorAll("th[scope='col'], [role='columnheader']"))
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => (el.textContent ?? "").trim()),
    );
  }

  // A choice in a radio group or segmented control, by its visible label.
  async chooseOption(label: string): Promise<void> {
    await this.press(await this.findByName("label, button, [role='radio']", label));
  }

  // Whether the user can select the view's text (nothing sets user-select: none on it).
  async textSelectable(): Promise<boolean> {
    return browser.execute(() => {
      const main = document.querySelector("h1")?.parentElement ?? document.body;
      return getComputedStyle(main).userSelect !== "none" && getComputedStyle(document.body).userSelect !== "none";
    });
  }

  // U12 compare mode: the rows in the order shown, "measured" then each model id.
  async replayRows(): Promise<string[]> {
    return browser.execute(() =>
      Array.from(document.querySelectorAll('[aria-label="Simulated total per model"] li[data-row]'), (row) => row.getAttribute("data-row") ?? ""),
    );
  }

  // U5: what one row shows after its Analyse was pressed (A33): its button
  // reads Sent, it shows the text to type in place of the button, or neither.
  async analyseRow(shortId: string): Promise<AnalyseRowState> {
    return browser.execute((id: string) => {
      if (document.querySelector(`button[aria-label="Sent: session ${id}"]`)) return "sent";
      const row = Array.from(document.querySelectorAll('[aria-label="Sessions"] > li')).find((candidate) => candidate.textContent?.includes(id));
      const status = row?.querySelector('[role="status"]')?.textContent ?? "";
      return status.startsWith("Ask in the chat:") ? "fallback" : "pending";
    }, shortId) as Promise<AnalyseRowState>;
  }

  // Text contrast (WCAG AA) and fit, judged as layout-theme.e2e.ts does.
  // The view is transparent, so the chat's ground (read in the workbench) is
  // painted on its root first; the probe would otherwise assume white.
  async contrastFindings(ground: string): Promise<{ texts: number; findings: string[] }> {
    await browser.execute((colour: string) => {
      document.documentElement.style.backgroundColor = colour;
    }, ground);
    try {
      const probe = (await browser.execute(`return ${PROBE_SCRIPT}`)) as Probe;
      return { texts: probe.texts.length, findings: judgeProbe(probe) };
    } finally {
      await browser.execute(() => {
        document.documentElement.style.backgroundColor = "";
      });
    }
  }
}

interface PartGeometry {
  placeholders: Rect[];
  overlays: { id: string; rect: Rect }[];
  list: Rect | null;
}

const GEOMETRY_SCRIPT = `(() => {
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
  const list = document.querySelector(${JSON.stringify(CHAT_LIST)});
  return {
    placeholders: [...document.querySelectorAll(${JSON.stringify(PLACEHOLDER)})].map(rect),
    overlays: [...document.querySelectorAll(${JSON.stringify(OVERLAY)})].filter((o) => getComputedStyle(o).visibility !== 'hidden' && getComputedStyle(o).display !== 'none').map((o) => ({ id: o.id, rect: rect(o.querySelector('iframe') || o) })),
    list: list ? rect(list) : null,
  };
})()`;

// The chat's MCP App views, from the workbench.
export class ChatViews {
  readonly view = new ChatView();

  async count(): Promise<number> {
    return browser.$$(PART).length;
  }

  // Chat requests shown in the chat: a drill-down inside a view must not add one.
  async requestCount(): Promise<number> {
    return browser.$$(REQUEST).length;
  }

  // The text of each request the chat shows (the list is virtualised: only
  // requests near the visible part are in the DOM).
  async requestTexts(): Promise<string[]> {
    return browser.execute((selector: string) => Array.from(document.querySelectorAll(selector), (element) => (element as HTMLElement).innerText), `${REQUEST} .value .rendered-markdown`);
  }

  // What the chat input shows ("" when empty; an empty input shows its placeholder outside the lines).
  async inputText(): Promise<string> {
    return browser.execute(() => (document.querySelector(".interactive-input-part .interactive-input-editor .view-lines") as HTMLElement | null)?.innerText ?? "");
  }

  // Waits until the chat's last response has finished.
  async waitForResponse(timeout: number): Promise<void> {
    await browser.waitUntil(async () => (await browser.$$(`${RESPONSE}.chat-response-loading`).length) === 0, {
      timeout,
      interval: 2_000,
      timeoutMsg: "the chat's response did not finish",
    });
  }

  async waitForViews(count: number, timeout: number): Promise<void> {
    await browser.waitUntil(async () => (await this.count()) >= count, { timeout, interval: 2_000, timeoutMsg: `fewer than ${count} MCP App views appeared in the chat` });
  }

  private async geometry(): Promise<PartGeometry> {
    return (await browser.execute(`return ${GEOMETRY_SCRIPT}`)) as PartGeometry;
  }

  // Scrolls the chat list with the mouse wheel until the index-th view's
  // placeholder starts at the top of it (the list is virtualised: no
  // scrollIntoView; the wheel moves it by a share of the delta, measured as
  // it goes). Stops where the list can't scroll further.
  async scrollTo(index: number): Promise<void> {
    let gain = 0.4;
    let stalls = 0;
    for (let attempt = 0; attempt < 40 && stalls < 3; attempt++) {
      const { placeholders, list } = await this.geometry();
      const target = placeholders[index];
      if (!target || !list) throw new Error(`The chat has no view ${index + 1}`);
      // Below the request pinned at the top of the chat.
      const distance = target.y - (list.y + TOP_MARGIN);
      if (Math.abs(distance) <= 24) return;
      const wanted = Math.max(-list.height * 0.6, Math.min(list.height * 0.6, distance));
      const deltaY = Math.round(wanted / gain);
      // Over the list's margin beside the views (the wider side).
      const leftGap = target.x - list.x;
      const rightGap = list.x + list.width - (target.x + target.width);
      const x = Math.round(leftGap >= rightGap ? list.x + leftGap / 2 : target.x + target.width + rightGap / 2);
      const y = Math.round(list.y + list.height / 2);
      // No origin: x and y are viewport coordinates.
      await browser.action("wheel").scroll({ x, y, deltaY, duration: 50 }).perform();
      await browser.pause(400);
      const moved = target.y - ((await this.geometry()).placeholders[index]?.y ?? target.y);
      // Views above resize as they load, so one step can look like no move;
      // three in a row is the end of the list.
      stalls = Math.abs(moved) < 2 ? stalls + 1 : 0;
      const measured = moved / deltaY;
      if (measured > 0.05 && measured < 3) gain = measured;
    }
  }

  // Enters the index-th view (in tool-call order); leave() goes back to the workbench.
  async enter(index: number): Promise<ChatView> {
    await browser.switchFrame(null);
    let overlayId: string | undefined;
    let last: PartGeometry | undefined;
    await browser.waitUntil(
      async () => {
        await this.scrollTo(index);
        last = await this.geometry();
        const placeholder = last.placeholders[index];
        overlayId = placeholder ? overlayOver(placeholder, last.overlays) : undefined;
        return overlayId !== undefined;
      },
      { timeout: 45_000, interval: 1_000, timeoutMsg: `no webview lies over view ${index + 1}` },
    ).catch((error: unknown) => {
      throw new Error(`${String(error)}; view at ${JSON.stringify(last?.placeholders[index])}, list ${JSON.stringify(last?.list)}, overlays ${JSON.stringify(last?.overlays)}`);
    });
    await browser.switchFrame(await browser.$(`${OVERLAY}[id="${overlayId}"] iframe`));
    const active = await browser.$("#active-frame");
    await active.waitForExist({ timeout: 30_000 });
    await browser.switchFrame(active);
    await browser.waitUntil(async () => (await this.view.snapshot()).footer !== "", { timeout: 30_000, timeoutMsg: `view ${index + 1} did not render` });
    return this.view;
  }

  async leave(): Promise<void> {
    await browser.switchFrame(null);
  }

  async inside<T>(index: number, act: (view: ChatView) => Promise<T>): Promise<T> {
    const view = await this.enter(index);
    try {
      return await act(view);
    } finally {
      await this.leave();
    }
  }

  // The width the chat gives its views (they all share it).
  async viewWidth(): Promise<number> {
    const { placeholders } = await this.geometry();
    if (!placeholders[0]) throw new Error("The chat shows no MCP App view to measure");
    return Math.round(placeholders[0].width);
  }

  // Sets the views' width (A24 1.8: about 360 px; 600 px) by dragging the
  // sash on the chat's side bar, as a user resizes it: the driver can't
  // resize the window, and VS Code has no command for an exact part size.
  // Returns the width reached: where a drag no longer changes it (the chat's
  // widest, in the suite's window about 576 px), it stops there.
  async setViewWidth(target: number): Promise<number> {
    let previous = -1;
    for (let attempt = 0; attempt < 6; attempt++) {
      const current = await this.viewWidth();
      if (isWithinTolerance(current, target) || current === previous) return current;
      previous = current;
      const marked = await browser.execute(() => {
        document.querySelectorAll("[data-g4-sash]").forEach((el) => el.removeAttribute("data-g4-sash"));
        const bar = document.querySelector(".part.auxiliarybar");
        if (!bar) return false;
        const left = bar.getBoundingClientRect().left;
        const sash = Array.from(document.querySelectorAll(".monaco-sash.vertical")).find((candidate) => {
          const rect = candidate.getBoundingClientRect();
          return rect.height > 100 && Math.abs(rect.left + rect.width / 2 - left) <= 6;
        });
        sash?.setAttribute("data-g4-sash", "");
        return sash !== undefined;
      });
      if (!marked) throw new Error("The chat's side bar has no sash to drag");
      // Dragging left widens the side bar.
      await browser
        .action("pointer")
        .move({ origin: (await browser.$("[data-g4-sash]")) as never })
        .down()
        .move({ origin: "pointer", x: current - target, y: 0, duration: 200 })
        .up()
        .perform();
      await browser.pause(500);
    }
    return this.viewWidth();
  }

  // The colour the chat paints behind its views (the first opaque background
  // from the placeholder outwards), for the contrast judge.
  async ground(): Promise<string> {
    return browser.execute((selector: string) => {
      for (let element = document.querySelector(selector); element; element = element.parentElement) {
        const colour = getComputedStyle(element).backgroundColor;
        if (colour && colour !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(colour)) return colour;
      }
      return getComputedStyle(document.body).backgroundColor;
    }, PLACEHOLDER);
  }
}
