// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// `npm run demo:record:terminal -w packages/vscode-extension -- N1 [--dry-run]`
// Plays a terminal scene on its own Xvfb (1600x1000, no window manager): two xterm windows run the real `npx`
// command from an `npm pack` tarball of packages/cli, and the CLI's own `xdg-open` call opens a throwaway Chromium (D29-D31).
// Writes <masters>/<id>-<slug>.mp4 plus .json. --dry-run plays without recording and saves a frame at each
// template wait to AICA_DEMO_DEBUG_DIR, to cut the templates from.
// Run it under `flock "$XDG_RUNTIME_DIR/aica-demo.lock"`.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, homedir, userInfo } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { FIXTURE_NOW } from "../../../../web/e2e/support/fixture-clock.ts";
import { mastersDir } from "../../../test/ui/demo/support/demo-launch.mts";
import { parseDesktopArgs } from "../desktop/desktop-args.mts";
import { freeDisplay } from "../desktop/desktop-session.mts";
import { ScreenProbe, missingTemplates } from "../desktop/screen-probe.mts";
import { waitForMatch } from "../desktop/wait-for-match.mts";
import { Xdotool } from "../desktop/xdotool.mts";
import { FRAME } from "../ffmpeg-args.mts";
import { sceneOutputs } from "../output-names.mts";
import { forbiddenTerms } from "../privacy-probe.mts";
import { startRecorder, type Recorder } from "../recorder.mts";
import { assertScene, playScene, totalBeatMs } from "../scene-timeline.mts";
import { startBrowserHost, type BrowserHost } from "./browser-host.mts";
import { waitForHealth } from "./health-wait.mts";
import { assertPortFree } from "./port-check.mts";
import { terminalEnv } from "./terminal-env.mts";
import { createTerminalHome } from "./terminal-home.mts";
import { terminalLayout, xtermArgs, type TerminalName } from "./terminal-layout.mts";
import { createTerminalRunner } from "./terminal-runner.mts";
import { TERMINAL_SCENES, sceneTemplates } from "./terminal-scenes.mts";
import { xdgOpenScript } from "./xdg-open-wrapper.mts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const APP_PORT = 5199;
const TYPE_DELAY_MS = 90;
const PACING = { timeoutMs: 60_000, intervalMs: 300 };
const log = (line: string) => console.log(`[demo:terminal] ${line}`);
const clock = { now: Date.now, sleep };

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync(command, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

// D29: the CLI as a user gets it, from a tarball in an empty folder. Installed with the real npm cache, before the
// terminals start, so nothing from the made-up HOME is touched and the take never reaches the registry.
function installTarball(demoDir: string, packDir: string): string {
  const cliDir = path.join(REPO_ROOT, "packages/cli");
  mkdirSync(packDir, { recursive: true });
  const packed = run("npm", ["pack", "--pack-destination", packDir, "--silent"], cliDir).trim().split("\n").pop()!;
  mkdirSync(demoDir, { recursive: true });
  writeFileSync(path.join(demoDir, "package.json"), '{"name":"demo","private":true}\n');
  run("npm", ["install", path.join(packDir, packed), "--no-audit", "--no-fund", "--ignore-scripts", "--loglevel=error"], demoDir);
  return packed;
}

async function endProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGTERM");
  const killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(killTimer);
}

async function waitFor<T>(what: string, timeoutMs: number, get: () => Promise<T | undefined>): Promise<T> {
  for (const end = Date.now() + timeoutMs; Date.now() < end; await sleep(250)) {
    const value = await get();
    if (value !== undefined) return value;
  }
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}`);
}

async function main(): Promise<void> {
  const args = parseDesktopArgs(process.argv.slice(2));
  const scene = TERMINAL_SCENES[args.scene ?? "N1"];
  if (!scene) throw new Error(`Unknown terminal scene "${args.scene}". Known: ${Object.keys(TERMINAL_SCENES).join(", ")}`);
  assertScene(scene);
  const missing = missingTemplates(sceneTemplates(scene));
  if (missing.length > 0 && !args.dryRun) {
    throw new Error(`Missing templates in scripts/demo/desktop/templates: ${missing.map((m) => `${m}.png`).join(", ")}. Run with --dry-run and AICA_DEMO_DEBUG_DIR, then cut them from the saved frames (crop only).`);
  }
  await assertPortFree(APP_PORT);

  const outputs = sceneOutputs(scene, { masters: mastersDir(), gifs: path.join(mastersDir(), "gifs") });
  const tmp = mkdtempSync(path.join(tmpdir(), "aica-demo-terminal-"));
  const children: ChildProcess[] = [];
  let host: BrowserHost | undefined;
  let recorder: Recorder | undefined;
  let finished = false;
  let probe: ScreenProbe | undefined;
  const sceneName = scene.id.toLowerCase();
  try {
    const home = path.join(tmp, "home");
    createTerminalHome(home);
    const demoDir = path.join(tmp, "demo");
    const packed = installTarball(demoDir, path.join(tmp, "pack"));
    log(`installed ${packed} into an empty demo folder`);

    const display = freeDisplay();
    children.push(spawn("Xvfb", [display, "-screen", "0", `${FRAME.width}x${FRAME.height}x24`, "-nolisten", "tcp"], { stdio: "ignore" }));
    await waitFor(`Xvfb ${display}`, 10_000, async () => (existsSync(`/tmp/.X11-unix/X${display.slice(1)}`) ? true : undefined));
    const xdo = new Xdotool(display);
    probe = new ScreenProbe(display, path.join(tmp, "frame.png"));

    const layout = terminalLayout(FRAME);
    const windows = {} as Record<TerminalName, string>;
    // D36: the bare word "fixture" is forbidden too, as in the web scenes (sceneForbiddenTerms).
    const forbidden = [...forbiddenTerms(process.env.DEMO_FORBIDDEN, { homedir: homedir(), username: userInfo().username }), "fixture"];

    const binDir = path.join(tmp, "bin");
    mkdirSync(binDir);
    host = await startBrowserHost({
      display,
      frame: layout.browser,
      now: FIXTURE_NOW,
      forbidden,
      openDelayMs: 2200,
      raiseWindow: async () => {
        const id = await xdo.findWindow("chrom");
        if (id) await xdo.raise(id);
      },
      placeWindow: async () => {
        const id = await waitFor("the browser window", 10_000, () => xdo.findWindow("chrom"));
        await xdo.placeWindow(id, layout.browser);
      },
      log,
    });
    const wrapper = path.join(binDir, "xdg-open");
    writeFileSync(wrapper, xdgOpenScript(host.controlPort));
    chmodSync(wrapper, 0o755);

    const env = terminalEnv({ home, binDir, display, now: FIXTURE_NOW, demoForbidden: process.env.DEMO_FORBIDDEN }, process.env);
    for (const name of ["A", "B"] as const) {
      children.push(spawn("xterm", xtermArgs(name, layout[name]), { cwd: demoDir, env, stdio: "ignore" }));
      windows[name] = await waitFor(`xterm ${name}`, 10_000, () => xdo.findWindowByName(`aica-terminal-${name.toLowerCase()}`));
      await xdo.placeWindow(windows[name], layout[name]);
    }
    // The grabbed cursor would sit mid-frame; park it in a corner.
    await xdo.move({ x: FRAME.width - 1, y: FRAME.height - 1 });
    await sleep(800);
    log(`${scene.id}: ${scene.steps.length} steps, ${(totalBeatMs(scene) / 1000).toFixed(1)} s of beats`);

    const debugDir = process.env.AICA_DEMO_DEBUG_DIR;
    const runner = createTerminalRunner({
      raise: async (t) => {
        await xdo.raise(windows[t]);
        // No window manager: the pointer decides nothing, focus was set by raise().
      },
      type: (text) => xdo.type(text, TYPE_DELAY_MS),
      press: (key) => xdo.key(key),
      waitHealth: () => waitForHealth(APP_PORT, (url) => fetch(url), PACING, clock),
      waitTemplate: async (template) => {
        if (args.dryRun) {
          await sleep(1200);
          if (debugDir) {
            mkdirSync(debugDir, { recursive: true });
            copyFileSync(await probe!.frameFilePath(), path.join(debugDir, `${template}-frame.png`));
          }
          return;
        }
        await waitForMatch(template, async () => {
          const m = await probe!.find(template);
          return m && m.score >= 0.9 ? m : undefined;
        }, PACING, clock);
      },
      startRecording: async () => {
        if (args.dryRun) return;
        recorder = startRecorder({ display, ...FRAME, out: outputs.mp4 });
        await recorder.ready();
      },
      browser: {
        waitOpened: (count) => host!.waitOpened(count, PACING.timeoutMs),
        analyzeClaudeCode: () => host!.analyzeClaudeCode(),
        show: () => host!.show(),
      },
    });
    await playScene(scene, (action) => runner.perform(action), sleep);
    await recorder?.stop();
    recorder = undefined;
    if (!args.dryRun) {
      writeFileSync(outputs.meta, JSON.stringify({ scene: scene.id, package: packed, recordedAt: new Date().toISOString() }, null, 2));
      log(`wrote ${outputs.mp4}`);
    } else log("dry run done; nothing was recorded");
    finished = true;
  } finally {
    if (!finished) await recorder?.discard();
    const debugDir = process.env.AICA_DEMO_DEBUG_DIR;
    if (!finished && debugDir && existsSync(path.join(tmp, "frame.png"))) {
      mkdirSync(debugDir, { recursive: true });
      copyFileSync(path.join(tmp, "frame.png"), path.join(debugDir, `${sceneName}-failed.png`));
    }
    if (!finished && debugDir && host) await host.screenshot(path.join(debugDir, `${sceneName}-page-failed.png`)).catch(() => undefined);
    await host?.stop();
    for (const child of children.splice(0).reverse()) await endProcess(child);
    // The CLI exits with its terminal's shell; make sure nothing keeps the port for the next take.
    await sleep(500);
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[demo:terminal] ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
