// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// `npm run demo:record:desktop -w packages/vscode-extension -- M1 [--dry-run]`
// Plays a Claude Desktop scene in Xvfb on the owner's signed-in demo profile over a fresh made-up-data home
// and writes <masters>/<id>-<slug>.mp4 plus .json (docs/plans/docs-refresh-and-demo-recordings.md §4.3).
// --dry-run launches Desktop, reports template scores and sends nothing.
// Run it under `flock "$XDG_RUNTIME_DIR/aica-demo.lock"`.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createFixtureHome } from "../../../../web/e2e/support/fixture-home.mts";
import { FIXTURE_NOW } from "../../../../web/e2e/support/fixture-clock.ts";
import { mastersDir } from "../../../test/ui/demo/support/demo-launch.mts";
import { FRAME } from "../ffmpeg-args.mts";
import { sceneOutputs } from "../output-names.mts";
import { startRecorder, type Recorder } from "../recorder.mts";
import { assertScene, playScene, totalBeatMs } from "../scene-timeline.mts";
import { createActionRunner } from "./action-runner.mts";
import { buildDesktopConfig, type DesktopConfig } from "./desktop-config.mts";
import { parseDesktopArgs } from "./desktop-args.mts";
import { DESKTOP_SCENES, sceneTemplates } from "./desktop-scenes.mts";
import { profileInUse, startDesktopSession } from "./desktop-session.mts";
import { ScreenProbe, missingTemplates, templatePath } from "./screen-probe.mts";
import { Xdotool } from "./xdotool.mts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../../..");
const PACING = { typeDelayMs: 60, timeoutMs: 120_000, intervalMs: 400 };
const log = (line: string) => console.log(`[demo:desktop] ${line}`);

function profileDir(): string {
  return process.env.AICA_DEMO_DESKTOP_PROFILE ?? path.join(homedir(), ".local/share/aica-demo-desktop");
}

function writeConfig(profile: string, home: string): void {
  const file = path.join(profile, "Claude", "claude_desktop_config.json");
  const existing = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as DesktopConfig) : undefined;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(buildDesktopConfig(existing, { serverScript: path.join(REPO_ROOT, "scripts/mcp-server.sh"), home, now: FIXTURE_NOW }), null, 2));
}

function desktopVersion(): string {
  return execFileSync("dpkg-query", ["-W", "-f", "${Version}", "claude-desktop"], { encoding: "utf8" }).trim();
}

// Chat mode with the new-chat composer showing; the profile may open in Code mode (§4.3).
async function reachNewChat(xdo: Xdotool, probe: ScreenProbe): Promise<void> {
  // Polled for a few seconds: the composer's blinking caret drops a single frame's score below the threshold.
  const composerShown = async () => {
    for (let tries = 0; tries < 8; tries++) {
      if (((await probe.find("new-chat-composer"))?.score ?? 0) >= 0.9) return true;
      await sleep(400);
    }
    return false;
  };
  if (await composerShown()) return;
  if (existsSync(templatePath("chat-toggle"))) {
    const toggle = await probe.find("chat-toggle");
    if (toggle && toggle.score >= 0.9) await xdo.click({ x: toggle.x + Math.floor(toggle.width / 2), y: toggle.y + Math.floor(toggle.height / 2) });
    await sleep(1500);
  }
  await xdo.key("ctrl+n");
  await sleep(1500);
  if (!(await composerShown())) {
    throw new Error("The new-chat composer is not showing: switch the demo profile to Chat mode once by hand (§4.3), or cut templates/chat-toggle.png");
  }
}

async function main(): Promise<void> {
  const args = parseDesktopArgs(process.argv.slice(2));
  const scene = args.scene === undefined ? DESKTOP_SCENES.M1 : DESKTOP_SCENES[args.scene];
  if (!scene) throw new Error(`Unknown Desktop scene "${args.scene}". Known: ${Object.keys(DESKTOP_SCENES).join(", ")}`);
  assertScene(scene);
  const needed = sceneTemplates(scene);
  const missing = missingTemplates([...needed, "always-allow", "stop"]);
  if (missing.length > 0 && !args.dryRun) {
    throw new Error(`Missing templates in scripts/demo/desktop/templates: ${missing.map((m) => `${m}.png`).join(", ")}. Cut them from a live frame (crop only, no names) before recording.`);
  }

  const profile = profileDir();
  if (profileInUse(profile)) throw new Error(`Claude Desktop is already running on ${profile}; close it first`);

  const outputs = sceneOutputs(scene, { masters: mastersDir(), gifs: path.join(mastersDir(), "gifs") });
  const tmp = mkdtempSync(path.join(tmpdir(), "aica-demo-desktop-"));
  let session: Awaited<ReturnType<typeof startDesktopSession>> | undefined;
  let recorder: Recorder | undefined;
  let finished = false;
  try {
    const home = path.join(tmp, "home");
    createFixtureHome(home);
    writeConfig(profile, home);
    session = await startDesktopSession(profile, (display) => new Xdotool(display), log);
    const probe = new ScreenProbe(session.display, path.join(tmp, "frame.png"));
    const { xdo } = session;

    await reachNewChat(xdo, probe);

    if (args.dryRun) {
      const names = [...new Set([...needed, "always-allow", "stop", "chat-toggle", "new-chat-composer"])].filter((n) => existsSync(templatePath(n)));
      const scores = await probe.scores(names);
      for (const [name, m] of Object.entries(scores)) log(`${name}: score ${m.score} at ${m.x},${m.y}`);
      log(`templates not yet cut: ${needed.filter((n) => !existsSync(templatePath(n))).join(", ") || "none"}`);
      // No frame is kept: the new-chat screen shows the owner's name and recent artifacts (D17).
      log("dry run done; nothing was sent");
      finished = true;
      return;
    }

    const runner = createActionRunner({
      input: xdo,
      find: (template) => probe.find(template),
      startRecording: async () => {
        recorder = startRecorder({ display: session!.display, ...FRAME, out: outputs.mp4 });
        await recorder.ready();
      },
      clock: { now: Date.now, sleep },
      pacing: PACING,
    });
    log(`${scene.id}: ${scene.steps.length} steps, ${(totalBeatMs(scene) / 1000).toFixed(1)} s of beats`);
    await playScene(scene, (action) => runner.perform(action), sleep);
    await recorder?.stop();
    recorder = undefined;
    writeFileSync(
      outputs.meta,
      JSON.stringify({ scene: scene.id, desktopVersion: desktopVersion(), recordedAt: new Date().toISOString(), retakeNeeded: runner.retakeNeeded() }, null, 2),
    );
    log(`wrote ${outputs.mp4}${runner.retakeNeeded() ? " (a permission prompt showed: retake needed)" : ""}`);
    finished = true;
  } finally {
    if (!finished) await recorder?.discard();
    // The last probed frame shows why a wait timed out. Only on request, outside the repo: it can show the account.
    const debugDir = process.env.AICA_DEMO_DEBUG_DIR;
    if (!finished && debugDir && existsSync(path.join(tmp, "frame.png"))) {
      mkdirSync(debugDir, { recursive: true });
      copyFileSync(path.join(tmp, "frame.png"), path.join(debugDir, `${scene.id.toLowerCase()}-failed.png`));
    }
    await session?.stop();
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[demo:desktop] ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
