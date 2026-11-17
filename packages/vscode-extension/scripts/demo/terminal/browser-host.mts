// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The browser behind the demo `xdg-open` wrapper (D31): a control port the wrapper posts URLs to, and a throwaway
// Playwright Chromium in kiosk mode with the fixed clock. Glue: the 10.22 exception applies, the scene asserts its end state.
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import { POINTER_OVERLAY_SCRIPT } from "../pointer-overlay.mts";
import { glidePath, type Point } from "../pointer-target.mts";
import { findForbidden } from "../privacy-probe.mts";
import type { Rect } from "./terminal-layout.mts";

export interface BrowserHostOptions {
  display: string;
  frame: Rect;
  now: string;
  forbidden: string[];
  // Raises the Chromium window; there is no window manager to do it.
  raiseWindow(): Promise<void>;
  // Moves and sizes the Chromium window to `frame` once it is open (kiosk mode alone fills the screen).
  placeWindow(): Promise<void>;
  // The browser covers the screen, so it opens or comes forward only after the terminal line has been on screen this long.
  openDelayMs: number;
  log(line: string): void;
}

export interface BrowserHost {
  controlPort: number;
  opens(): number;
  waitOpened(count: number, timeoutMs: number): Promise<void>;
  analyzeClaudeCode(): Promise<void>;
  show(): Promise<void>;
  // The page as Playwright sees it, for diagnosing a failed take. Never committed: it can show anything the page shows.
  screenshot(file: string): Promise<void>;
  stop(): Promise<void>;
}

const wait = async (what: string, timeoutMs: number, ok: () => boolean): Promise<void> => {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(100)) if (ok()) return;
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`);
};

export async function startBrowserHost(o: BrowserHostOptions): Promise<BrowserHost> {
  const profile = mkdtempSync(path.join(tmpdir(), "aica-demo-chromium-"));
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let opens = 0;
  let launching: Promise<void> | undefined;

  const launch = async (url: string): Promise<void> => {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      ...(executablePath ? { executablePath } : {}),
      viewport: null,
      colorScheme: "dark",
      env: { ...process.env, DISPLAY: o.display, WAYLAND_DISPLAY: "" } as Record<string, string>,
      args: ["--kiosk", `--window-position=${o.frame.x},${o.frame.y}`, `--window-size=${o.frame.width},${o.frame.height}`, "--no-first-run", "--no-default-browser-check", "--disable-infobars", "--password-store=basic"],
    });
    // Dark, as every web demo (owner decision 2026-11-14): the app reads this before its first render.
    await context.addInitScript(() => window.localStorage.setItem("aca.colorMode", "dark"));
    await context.clock.setFixedTime(new Date(o.now));
    page = context.pages()[0] ?? (await context.newPage());
    await page.goto(url);
    await o.placeWindow();
  };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("url");
    // Only the CLI's own loopback URL is ever opened.
    if (!url || !/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) {
      res.writeHead(400).end("not a loopback app URL");
      return;
    }
    const first = opens === 0;
    opens++;
    o.log(`xdg-open ${url} (open ${opens})`);
    const work = first ? (launching ??= sleep(o.openDelayMs).then(() => launch(url))) : sleep(o.openDelayMs).then(() => o.raiseWindow());
    work.then(
      () => res.writeHead(204).end(),
      (error: unknown) => {
        o.log(`browser host: ${error instanceof Error ? error.message : error}`);
        res.writeHead(500).end();
      },
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const controlPort = (server.address() as { port: number }).port;

  const assertPrivate = async (): Promise<void> => {
    const text = await page!.evaluate(() => document.body.innerText);
    const hits = findForbidden([{ source: "browser page", text: `${text}\n${page!.url()}` }], o.forbidden);
    if (hits.length > 0) throw new Error(`Forbidden text on screen: ${hits.map((h) => `${h.match} in ${h.source}`).join(", ")}`);
  };

  // The shared drawn pointer, moved at demo pace like the W scenes' Pointer.
  type PointerApi = { __demoPointer: { moveTo(x: number, y: number): void; ripple(): void } };
  let at: Point = { x: 800, y: 500 };
  // The header re-lays out while the provider list loads; glide only once the control has stopped moving.
  const settledBox = async (target: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
    let last = await target.boundingBox();
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      const now = await target.boundingBox();
      if (now && last && now.x === last.x && now.y === last.y && now.width === last.width) return now;
      last = now;
    }
    throw new Error("Pointer target never settled");
  };
  const glideTo = async (target: Locator): Promise<void> => {
    const box = await settledBox(target);
    const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    for (const point of glidePath(at, to, 18)) {
      await page!.evaluate(({ x, y }) => (window as unknown as PointerApi).__demoPointer.moveTo(x, y), point);
      await sleep(22);
    }
    at = to;
    await page!.evaluate(() => (window as unknown as PointerApi).__demoPointer.ripple());
  };

  return {
    controlPort,
    opens: () => opens,
    async waitOpened(count, timeoutMs) {
      await wait(`browser open #${count}`, timeoutMs, () => opens >= count);
      if (count === 1) {
        await launching;
        await page!.getByText("Analyze", { exact: true }).waitFor();
        await assertPrivate();
      }
    },
    async analyzeClaudeCode() {
      const p = page!;
      await p.evaluate(POINTER_OVERLAY_SCRIPT);
      await p.evaluate(({ x, y }) => (window as unknown as PointerApi).__demoPointer.moveTo(x, y), at);
      const analyze = p.getByText("Analyze", { exact: true });
      await glideTo(analyze);
      await analyze.click();
      await sleep(500);
      const source = p.getByRole("combobox", { name: "Log provider" });
      await glideTo(source);
      const switched = p.waitForResponse((r) => r.url().endsWith("/api/log-providers/active") && r.ok());
      // selectOption sets the value without opening the native list (as the web demo driver's pointer.select does).
      await source.selectOption("claude-code");
      await switched;
      // End state of beat 3: the made-up Claude Code sessions are listed.
      await p.getByText(/\d+ turns?/).first().waitFor();
      await assertPrivate();
    },
    async show() {
      await o.raiseWindow();
      await assertPrivate();
    },
    async screenshot(file) {
      await page?.screenshot({ path: file });
    },
    async stop() {
      await context?.close().catch(() => undefined);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
