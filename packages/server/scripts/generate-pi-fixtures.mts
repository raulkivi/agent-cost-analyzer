// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Generates the Phase 11 pi fixtures with the owner's real pi and LOCAL model
// (owner decision 2026-11-14; the one exception to "no local model" in this
// repo, for generating pi test data only). Run on the owner's PC, never in CI:
//
//   npm run fixtures:generate-pi -w packages/server -- [--quick] \
//     [--idle-seconds 310] [--scenarios s1,s2,s3,s4] [--gondolin] \
//     [--provider llamacpp] [--model <id>] [--out <dir>] [--pi <command>] \
//     [--timeout-seconds 900] [--keep-temp]
//
// It builds a throwaway pi home under the OS temp dir (agent dir with one
// model copied from ~/.pi/agent/models.json, compaction settings and the
// repo's pi-system-prompt-logger build; never auth.json or the owner's
// sessions), drives pi in RPC mode through the scenarios in
// generate-pi-fixtures-lib.mts, one pi process at a time, then redacts every
// session and its sidecar records (redact-pi-capture-lib.mts) and writes them
// with a manifest to fixtures/pi-agent/generated/ (gondolin/ for --gondolin).
// Prints counts only, never generated text.
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { accessSync, constants as fsConstants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildManifest,
  buildTempModelsJson,
  buildTempSettings,
  countSession,
  dashedPath,
  lastAssistantContextTokens,
  parseGeneratorArgs,
  refusalReason,
  resolvePiCommand,
  SCENARIOS,
  WORKSPACE_FILES,
  type CompactionBudget,
  type GeneratorArgs,
  type ManifestFile,
  type ManifestScenario,
  type ModelOverrides,
  type ModelsJson,
  type Scenario,
} from "./generate-pi-fixtures-lib.mjs";
import { deriveContext, redactCapture, type RedactionContext } from "./redact-pi-capture-lib.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");
const defaultOutDir = path.resolve(scriptDir, "../fixtures/pi-agent/generated");
const ownerAgentDir = process.env.PI_CODING_AGENT_DIR ?? path.join(homedir(), ".pi", "agent");

// pi's clamp keeps 4096 tokens of margin below the context window for small
// windows (pi-ai clampMaxTokensToContext).
const PI_CONTEXT_SAFETY_TOKENS = 4096;
// Compaction keeps little recent context so a summary actually replaces
// history in these short sessions.
const BASE_BUDGET: CompactionBudget = { reserveTokens: 16384, keepRecentTokens: 64 };

function log(message: string): void {
  console.log(`[generate-pi-fixtures] ${message}`);
}

function isExecutable(file: string): boolean {
  try {
    accessSync(file, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// ---- RPC client ----

type Rpc = Record<string, unknown>;

class PiRpc {
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<string, (record: Rpc) => void>();
  private readonly listeners = new Set<(record: Rpc) => void>();
  private exited = false;
  private stderrTail = "";
  readonly events: { compactions: string[]; uiRequests: string[]; errors: string[] } = { compactions: [], uiRequests: [], errors: [] };

  constructor(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
    this.child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.setEncoding("utf8");
    // Split on LF only: JSON strings may hold U+2028/U+2029 (docs/rpc.md "Framing").
    this.child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let newline = this.buffer.indexOf("\n");
      while (newline !== -1) {
        const raw = this.buffer.slice(0, newline).replace(/\r$/, "");
        this.buffer = this.buffer.slice(newline + 1);
        if (raw.trim()) this.handle(raw);
        newline = this.buffer.indexOf("\n");
      }
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-2000);
    });
    this.child.on("exit", () => {
      this.exited = true;
    });
  }

  private handle(raw: string): void {
    let record: Rpc;
    try {
      record = JSON.parse(raw) as Rpc;
    } catch {
      return;
    }
    if (record.type === "response" && typeof record.id === "string") {
      this.pending.get(record.id)?.(record);
      this.pending.delete(record.id);
    }
    if (record.type === "extension_ui_request") this.answerUi(record);
    if (record.type === "compaction_end") {
      this.events.compactions.push(`${String(record.reason)}:${record.result ? "ok" : record.aborted ? "aborted" : "failed"}`);
    }
    if (record.type === "extension_error") this.events.errors.push(`extension_error in ${String(record.event)}`);
    for (const listener of this.listeners) listener(record);
  }

  // Dialogs would block a headless run; cancel them and note the method.
  private answerUi(record: Rpc): void {
    const method = String(record.method ?? "");
    if (["select", "confirm", "input", "editor"].includes(method)) {
      this.events.uiRequests.push(method);
      this.write({ type: "extension_ui_response", id: record.id, cancelled: true });
    }
  }

  private write(record: Rpc): void {
    this.child.stdin.write(`${JSON.stringify(record)}\n`);
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s waiting for ${what}`)), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  async command(record: Rpc, timeoutMs: number): Promise<Rpc> {
    if (this.exited) throw new Error(`pi exited early. stderr tail: ${this.stderrTail}`);
    const id = `c${this.nextId++}`;
    const response = new Promise<Rpc>((resolve) => this.pending.set(id, resolve));
    this.write({ ...record, id });
    const result = await this.withTimeout(response, timeoutMs, `${String(record.type)} response`);
    if (result.success !== true) throw new Error(`pi rejected ${String(record.type)}: ${String(result.error)}`);
    return result;
  }

  // Subscribes before sending so a fast run's agent_settled is not missed.
  async prompt(message: string, timeoutMs: number): Promise<void> {
    let settle: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const listener = (record: Rpc): void => {
      if (record.type === "agent_settled") settle();
    };
    this.listeners.add(listener);
    try {
      const response = await this.command({ type: "prompt", message }, timeoutMs);
      if ((response.data as Rpc | undefined)?.disposition === "handled") return;
      await this.withTimeout(settled, timeoutMs, "agent_settled");
    } finally {
      this.listeners.delete(listener);
    }
  }

  async close(): Promise<void> {
    if (this.exited) return;
    const exited = new Promise<void>((resolve) => this.child.once("exit", () => resolve()));
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill("SIGTERM"), 30_000);
    await exited;
    clearTimeout(timer);
  }
}

// ---- environment ----

interface TempHome {
  root: string;
  home: string;
  agentDir: string;
  workspace: string;
  sidecarPath: string;
}

function makeTempHome(loggerBundle: string): TempHome {
  const root = mkdtempSync(path.join(tmpdir(), "pi-fixtures-"));
  const home = path.join(root, "home");
  const agentDir = path.join(home, ".pi", "agent");
  const workspace = path.join(home, "project");
  mkdirSync(path.join(agentDir, "extensions"), { recursive: true });
  mkdirSync(path.join(agentDir, "logs"), { recursive: true });
  mkdirSync(workspace, { recursive: true });
  copyFileSync(loggerBundle, path.join(agentDir, "extensions", "pi-system-prompt-logger.js"));
  for (const [name, text] of Object.entries(WORKSPACE_FILES)) writeFileSync(path.join(workspace, name), text);
  try {
    execFileSync("git", ["init", "-q"], { cwd: workspace, stdio: "ignore" });
  } catch {
    // git is optional; the workspace works without it
  }
  return { root, home, agentDir, workspace, sidecarPath: path.join(agentDir, "logs", "system-prompts.jsonl") };
}

function writeAgentConfig(t: TempHome, owner: ModelsJson, provider: string, model: string, overrides: ModelOverrides, budget: CompactionBudget): void {
  writeFileSync(path.join(t.agentDir, "models.json"), JSON.stringify(buildTempModelsJson(owner, provider, model, overrides), null, 2));
  writeFileSync(path.join(t.agentDir, "settings.json"), JSON.stringify(buildTempSettings(provider, model, budget), null, 2));
}

function piEnv(t: TempHome): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PI_CODING_AGENT_DIR: t.agentDir,
    PI_SYSTEM_PROMPT_LOG_PATH: t.sidecarPath,
    PI_OFFLINE: "1",
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
  };
}

async function checkEndpoint(baseUrl: string): Promise<void> {
  try {
    // Any HTTP answer (even 401) means the server is up.
    await fetch(`${baseUrl.replace(/\/$/, "")}/models`, { signal: AbortSignal.timeout(5000) });
  } catch {
    throw new Error(`The model server at ${baseUrl} is not reachable. Start the local model server and retry.`);
  }
}

function buildLogger(): string {
  log("building pi-system-prompt-logger");
  execFileSync("npm", ["run", "bundle", "--workspace=packages/pi-system-prompt-logger"], { cwd: repoRoot, stdio: "ignore" });
  const bundle = path.join(repoRoot, "packages/pi-system-prompt-logger/dist/pi-system-prompt-logger.js");
  if (!existsSync(bundle)) throw new Error(`Logger bundle missing: ${bundle}`);
  return bundle;
}

// ---- scenarios ----

interface RunContext {
  args: GeneratorArgs;
  piCommand: string;
  owner: ModelsJson;
  provider: string;
  model: string;
  gondolinPath?: string;
}

interface ScenarioRun {
  sessionFiles: { stem: string; path: string }[];
  note?: string;
}

function piArgs(ctx: RunContext, sessionFile?: string): string[] {
  const args = ["--mode", "rpc", "--no-mcp"];
  if (sessionFile) args.push("--session", sessionFile);
  if (ctx.gondolinPath) args.push("-e", ctx.gondolinPath);
  return args;
}

function windowFor(kind: "threshold" | "length", contextTokens: number): { overrides: ModelOverrides; budget: CompactionBudget } {
  if (kind === "threshold") {
    // contextTokens > window - reserve, so pi compacts before the next prompt,
    // while the prompt after it keeps ~6000 output tokens of room.
    return {
      overrides: { contextWindow: contextTokens + PI_CONTEXT_SAFETY_TOKENS + 6000 },
      budget: { reserveTokens: PI_CONTEXT_SAFETY_TOKENS + 8000, keepRecentTokens: BASE_BUDGET.keepRecentTokens },
    };
  }
  // A few hundred output tokens of room, far below maxTokens: the response
  // stops on `length`, which pi recovers from (context_edit + compaction).
  return {
    overrides: { contextWindow: contextTokens + PI_CONTEXT_SAFETY_TOKENS + 300, maxTokens: 16384 },
    budget: { reserveTokens: 0, keepRecentTokens: BASE_BUDGET.keepRecentTokens },
  };
}

async function runScenario(ctx: RunContext, scenario: Scenario, t: TempHome): Promise<ScenarioRun> {
  const timeoutMs = ctx.args.timeoutSeconds * 1000;
  writeAgentConfig(t, ctx.owner, ctx.provider, ctx.model, {}, BASE_BUDGET);
  let rpc = new PiRpc(ctx.piCommand, piArgs(ctx), t.workspace, piEnv(t));
  const processes = [rpc];
  const files: { stem: string; path: string }[] = [];
  const notes: string[] = [];
  const sessionFileOf = async (): Promise<string> => String(((await rpc.command({ type: "get_state" }, 60_000)).data as Rpc).sessionFile);
  try {
    let sessionFile = await sessionFileOf();
    for (const step of scenario.steps) {
      if (step.kind === "prompt") {
        log(`${scenario.id}: prompt`);
        await rpc.prompt(step.text, timeoutMs);
      } else if (step.kind === "idle") {
        log(`${scenario.id}: idle ${ctx.args.idleSeconds}s`);
        await new Promise((resolve) => setTimeout(resolve, ctx.args.idleSeconds * 1000));
      } else if (step.kind === "compact") {
        log(`${scenario.id}: /compact`);
        await rpc.command({ type: "compact" }, timeoutMs);
      } else if (step.kind === "restart") {
        await rpc.close();
        const contextTokens = lastAssistantContextTokens(readFileSync(sessionFile, "utf8"));
        if (contextTokens === null) throw new Error(`${scenario.id}: no assistant usage to size the window from`);
        const { overrides, budget } = windowFor(step.window, contextTokens);
        log(`${scenario.id}: restart with a ${step.window} window (${String(overrides.contextWindow)} tokens)`);
        writeAgentConfig(t, ctx.owner, ctx.provider, ctx.model, overrides, budget);
        rpc = new PiRpc(ctx.piCommand, piArgs(ctx, sessionFile), t.workspace, piEnv(t));
        processes.push(rpc);
        sessionFile = await sessionFileOf();
      } else if (step.kind === "fork") {
        const entries = ((await rpc.command({ type: "get_entries" }, 60_000)).data as { entries: Rpc[] }).entries;
        const users = entries.filter((e) => (e.message as Rpc | undefined)?.role === "user");
        const target = users[step.userMessageIndex];
        if (!target) throw new Error(`${scenario.id}: no user message #${step.userMessageIndex} to fork from`);
        files.push({ stem: `${scenario.stem}-parent`, path: sessionFile });
        log(`${scenario.id}: /fork`);
        const forked = await rpc.command({ type: "fork", entryId: target.id }, 60_000);
        if ((forked.data as Rpc | undefined)?.cancelled === true) throw new Error(`${scenario.id}: fork was cancelled`);
        sessionFile = await sessionFileOf();
        await rpc.prompt(step.text, timeoutMs);
      }
    }
    files.push({ stem: scenario.stem, path: sessionFile });
    const all = (pick: (p: PiRpc) => string[]): string[] => processes.flatMap(pick);
    const compactions = all((p) => p.events.compactions);
    const uiRequests = all((p) => p.events.uiRequests);
    const errors = all((p) => p.events.errors);
    if (compactions.length > 0) notes.push(`compactions: ${compactions.join(", ")}`);
    if (uiRequests.length > 0) notes.push(`cancelled dialogs: ${uiRequests.join(", ")}`);
    if (errors.length > 0) notes.push(errors.join(", "));
  } finally {
    await rpc.close();
  }
  return { sessionFiles: files, ...(notes.length ? { note: notes.join("; ") } : {}) };
}

// Fails loudly when a scenario did not produce what it exists for.
function checkScenario(scenario: Scenario, run: ScenarioRun): string[] {
  const main = run.sessionFiles.find((f) => f.stem === scenario.stem);
  const counts = main ? countSession(readFileSync(main.path, "utf8")) : undefined;
  const warnings: string[] = [];
  if (!counts) throw new Error(`${scenario.id}: no session file`);
  if (scenario.id === "s1" && counts.toolCalls < 1) throw new Error("s1: expected at least one tool call");
  if (scenario.id === "s2") {
    if (counts.compactions < 1) throw new Error("s2: expected a compaction");
    if (counts.compactions < 2) warnings.push("s2: only one compaction; the threshold compaction did not happen");
  }
  if (scenario.id === "s3" && counts.contextEdits < 1) {
    throw new Error("s3: pi appended no context_edit; the length recovery did not trigger");
  }
  return warnings;
}

// ---- redaction and output ----

function redactionContext(t: TempHome): RedactionContext {
  return deriveContext(t.workspace, {
    paths: [
      { from: t.home, to: "/home/user" },
      { from: dashedPath(t.home), to: "home-user" },
      { from: t.root, to: "/home/user" },
    ],
  });
}

async function writeOutputs(t: TempHome, runs: Map<Scenario, ScenarioRun>, outDir: string): Promise<Map<Scenario, ManifestFile[]>> {
  const sidecarText = existsSync(t.sidecarPath) ? readFileSync(t.sidecarPath, "utf8") : "";
  const ctx = redactionContext(t);
  const results = new Map<Scenario, ManifestFile[]>();
  const pendingWrites: { file: string; text: string }[] = [];
  for (const [scenario, run] of runs) {
    const files: ManifestFile[] = [];
    for (const { stem, path: sessionPath } of run.sessionFiles) {
      const result = await redactCapture({ sessionText: readFileSync(sessionPath, "utf8"), sessionPath, sidecarText, stem, context: ctx });
      if (result.leaks.length > 0) throw new Error(`${stem}: leak scan found ${result.leaks.join(", ")}; nothing written`);
      if (result.diffs.length > 0) throw new Error(`${stem}: the provider reads the redacted copy differently:\n${result.diffs.join("\n")}`);
      pendingWrites.push({ file: `${stem}.jsonl`, text: result.sessionText });
      if (result.recordCount > 0) pendingWrites.push({ file: `${stem}.system-prompts.jsonl`, text: result.sidecarText });
      files.push({
        file: `${stem}.jsonl`,
        ...(result.recordCount > 0 ? { sidecar: `${stem}.system-prompts.jsonl` } : {}),
        sidecarRecords: result.recordCount,
        counts: countSession(result.sessionText),
      });
    }
    results.set(scenario, files);
  }
  // Only after every file passed: replace the regenerated scenarios' files.
  mkdirSync(outDir, { recursive: true });
  const stems = [...runs.keys()].map((s) => s.stem);
  for (const name of readdirSync(outDir)) {
    if (name.endsWith(".jsonl") && stems.some((stem) => name.startsWith(`${stem}.`) || name.startsWith(`${stem}-`))) {
      rmSync(path.join(outDir, name));
    }
  }
  for (const { file, text } of pendingWrites) writeFileSync(path.join(outDir, file), text);
  return results;
}

function printCounts(files: ManifestFile[]): void {
  for (const f of files) {
    const c = f.counts;
    log(`  ${f.file}: turns ${c.turns}, tool calls ${c.toolCalls}, compactions ${c.compactions}, context_edits ${c.contextEdits}, sidecar records ${f.sidecarRecords}`);
    log(`    entry types ${JSON.stringify(c.entryTypes)}; roles ${JSON.stringify(c.messageRoles)}; stop reasons ${JSON.stringify(c.stopReasons)}`);
  }
}

async function main(): Promise<void> {
  const refusal = refusalReason(process.env);
  if (refusal) {
    console.error(refusal);
    process.exit(2);
  }
  const args = parseGeneratorArgs(process.argv.slice(2));
  const ownerSettings = JSON.parse(readFileSync(path.join(ownerAgentDir, "settings.json"), "utf8")) as Record<string, unknown>;
  const owner = JSON.parse(readFileSync(path.join(ownerAgentDir, "models.json"), "utf8")) as ModelsJson;
  const provider = args.provider ?? String(ownerSettings.defaultProvider ?? "");
  const model = args.model ?? String(ownerSettings.defaultModel ?? "");
  const baseUrl = String(buildTempModelsJson(owner, provider, model).providers[provider].baseUrl ?? "");
  await checkEndpoint(baseUrl);
  const piCommand = args.piCommand ?? resolvePiCommand(process.env.PATH ?? "", isExecutable);
  if (!piCommand) throw new Error("No pi on PATH outside node_modules; pass --pi <command>.");
  const piVersion = execFileSync(piCommand, ["--version"], { encoding: "utf8" }).trim();
  const gondolinPath = args.gondolin ? path.join(ownerAgentDir, "extensions", "gondolin") : undefined;
  if (gondolinPath && !existsSync(gondolinPath)) throw new Error(`--gondolin: no extension at ${gondolinPath}`);
  const variant = args.gondolin ? "gondolin" : "default";
  const outDir = args.out ?? (args.gondolin ? path.join(defaultOutDir, "gondolin") : defaultOutDir);
  log(`pi ${piVersion}, model ${provider}/${model}, variant ${variant}, scenarios ${args.scenarios.join(",")}, idle ${args.idleSeconds}s`);

  const t = makeTempHome(buildLogger());
  const ctx: RunContext = { args, piCommand, owner, provider, model, ...(gondolinPath ? { gondolinPath } : {}) };
  const runs = new Map<Scenario, ScenarioRun>();
  const manifestScenarios: ManifestScenario[] = [];
  const durations = new Map<Scenario, number>();
  const started = Date.now();
  try {
    for (const id of args.scenarios) {
      const scenario = SCENARIOS[id];
      const t0 = Date.now();
      const run = await runScenario(ctx, scenario, t);
      const warnings = checkScenario(scenario, run);
      durations.set(scenario, (Date.now() - t0) / 1000);
      runs.set(scenario, warnings.length ? { ...run, note: [run.note, ...warnings].filter(Boolean).join("; ") } : run);
      log(`${id}: done in ${Math.round((Date.now() - t0) / 1000)}s${warnings.length ? ` (${warnings.join("; ")})` : ""}`);
    }
    const written = await writeOutputs(t, runs, outDir);
    for (const [scenario, files] of written) {
      const run = runs.get(scenario) as ScenarioRun;
      manifestScenarios.push({
        id: scenario.id,
        stem: scenario.stem,
        status: "ok",
        ...(run.note ? { note: run.note } : {}),
        files,
        durationSeconds: Math.round(durations.get(scenario) ?? 0),
      });
      log(`${scenario.id} ${scenario.stem}:`);
      printCounts(files);
    }
    // A partial run keeps the other scenarios' entries from the last run.
    const manifestPath = path.join(outDir, "manifest.json");
    const previous = existsSync(manifestPath)
      ? ((JSON.parse(readFileSync(manifestPath, "utf8")) as { scenarios?: ManifestScenario[] }).scenarios ?? [])
      : [];
    const kept = previous.filter((p) => !manifestScenarios.some((s) => s.id === p.id));
    const manifest = buildManifest({
      piVersion,
      provider,
      model,
      variant,
      generatedOn: new Date().toISOString().slice(0, 10),
      idleSeconds: args.idleSeconds,
      scenarios: [...kept, ...manifestScenarios].sort((a, b) => a.id.localeCompare(b.id)),
    });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    log(`wrote ${manifestScenarios.length} scenario(s) to ${path.relative(repoRoot, outDir)} in ${Math.round((Date.now() - started) / 1000)}s`);
  } finally {
    if (args.keepTemp) log(`kept the temp pi home (unredacted) at ${t.root}`);
    else rmSync(t.root, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(`[generate-pi-fixtures] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
