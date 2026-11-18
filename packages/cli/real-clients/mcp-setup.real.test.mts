// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// MC8: `mcp install`, `status` and `uninstall` of the built CLI against the
// REAL client programs on this machine (mcp-client-setup.md §7 item 7; Linux
// only, D13). Opt-in and local only, like the REAL_DATA checks:
//
//   npm run test:real-clients:mcp-setup      (builds first; sets REAL_CLIENTS=1)
//
// Without REAL_CLIENTS=1 every test here is skipped. Safety:
//   - each test gets a fresh temporary HOME (and XDG_CONFIG_HOME inside it);
//     CODEX_HOME and APPDATA are unset; VS Code, Claude and Anthropic
//     variables are dropped so no client reaches a running app;
//   - a recording shim stands in front of each real client program and logs
//     its HOME; the run fails if any call used another home;
//   - the owner's real client configs are hashed before and after the run
//     (~/.claude.json only informationally: a running Claude Code session
//     writes it);
//   - no login, no publish, no global install; `npx` is a stand-in that runs
//     the locally built bin, so `claude mcp get` needs no network.
// A client that is not on the real PATH is skipped with its reason. Claude
// Desktop is a GUI app, so there is nothing to run. The summary printed at
// the end is what the owner signs off.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, type TestContext } from "vitest";
import { clientSetup, type McpScope } from "../../server/src/mcp/client-setup/client-setup.js";
import {
  claudeGetStatus,
  guardedFiles,
  hashChanges,
  hashFiles,
  realClientsEnabled,
  redactTemp,
  shimCallProblems,
  statusRow,
  summaryTable,
  vscodeEntryProblems,
  type FileHashes,
  type SummaryRow,
} from "./checks.mts";
import { cliVersion, createSandbox, realTools, type RealTool, type Sandbox } from "./sandbox.mts";

const enabled = realClientsEnabled(process.env);
const NAME = "agent-cost-analyzer";
const VSCODE_TIMEOUT = 20_000;

const realHome = homedir();
const tools = realTools();
const version = cliVersion();
const rows: SummaryRow[] = [];
const sandboxes: Sandbox[] = [];
let before: FileHashes = {};

const readText = (file: string): string | undefined => (existsSync(file) ? readFileSync(file, "utf8") : undefined);
interface ConfigJson {
  mcpServers?: Record<string, unknown>;
  servers?: Record<string, unknown>;
  projects?: Record<string, { mcpServers?: Record<string, unknown> }>;
}
const readJson = (file: string): ConfigJson => JSON.parse(readFileSync(file, "utf8")) as ConfigJson;
const out = (run: { stdout: string; stderr: string }) => `${run.stdout}${run.stderr}`;

const sandbox = (): Sandbox => {
  const made = createSandbox(Object.fromEntries(Object.entries(tools).filter(([, real]) => real !== undefined)));
  sandboxes.push(made);
  return made;
};

/** Records the check's result for the summary, and skips with a reason when the client is not installed. */
async function check(ctx: TestContext, client: string, scope: string, need: RealTool | undefined, reason: string, body: () => Promise<string | void>): Promise<void> {
  if (need !== undefined && tools[need] === undefined) {
    rows.push({ client, scope, result: `skipped: ${reason}` });
    ctx.skip(reason);
  }
  try {
    const note = await body();
    rows.push({ client, scope, result: note === undefined ? "pass" : `pass (${note})` });
  } catch (error) {
    rows.push({ client, scope, result: "FAIL" });
    throw error;
  }
}

beforeAll(() => {
  before = hashFiles(guardedFiles(realHome), readText);
});

afterAll(() => {
  if (!enabled) return;
  const after = hashFiles(guardedFiles(realHome), readText);
  const changes = hashChanges(before, after);
  const guarded = Object.entries(after).map(([file, hash]) => `${path.posix.relative(realHome, file)}: ${hash === "absent" ? "absent" : "sha256 unchanged"}`);
  const callProblems = (Object.keys(tools) as RealTool[]).flatMap((tool) =>
    sandboxes.flatMap((made) => shimCallProblems(tool, made.callLines(tool), made.home)),
  );
  const calls = (Object.keys(tools) as RealTool[]).map((tool) => `${tool}: ${sandboxes.reduce((sum, made) => sum + made.calls(tool).length, 0)} calls, all with the temporary HOME`);
  const text = [
    "",
    "mcp-setup real-client check",
    `built CLI ${NAME} ${version}, ${sandboxes.length} sandboxes`,
    "",
    summaryTable(rows),
    "",
    "hash guard (owner's real configs, before and after the run):",
    ...guarded.map((line) => `  ${line}`),
    `  ~/.claude.json: informational only; a running Claude Code session writes it`,
    "shim log (client programs run):",
    ...calls.map((line) => `  ${line}`),
    "",
  ].join("\n");
  console.log(sandboxes.reduce((acc, made) => redactTemp(acc, made.root), text));
  if (changes.length > 0) throw new Error(`the owner's real client configs changed during the run:\n${changes.join("\n")}`);
  if (callProblems.length > 0) throw new Error(`a real client ran outside the temporary home:\n${callProblems.join("\n")}`);
});

const claudeEntry = (made: Sandbox, scope: McpScope): unknown => {
  switch (scope) {
    case "user":
      return readJson(path.join(made.home, ".claude.json")).mcpServers?.[NAME];
    case "local":
      return readJson(path.join(made.home, ".claude.json")).projects?.[made.project]?.mcpServers?.[NAME];
    case "project":
      return readJson(path.join(made.project, ".mcp.json")).mcpServers?.[NAME];
  }
};

describe.skipIf(!enabled)("Claude Code (real claude)", () => {
  const MISSING = "claude is not on PATH";

  for (const scope of ["user", "local", "project"] as const) {
    it(`installs, health-checks, re-installs and uninstalls at ${scope} scope`, async (ctx) => {
      await check(ctx, "Claude Code", scope, "claude", MISSING, async () => {
        const made = sandbox();
        const flags = ["--client", "claude-code", "--scope", scope, "--yes"];
        const expected = clientSetup("claude-code", { version, pin: false, projectBillingDetails: false, platform: "linux", scope }).launch;

        const install = await made.aca(["mcp", "install", ...flags]);
        expect(install.code, out(install)).toBe(0);
        expect(statusRow((await made.aca(["mcp", "status", "--scope", scope])).stdout, "Claude Code")).toBe("registered (latest)");

        const get = await made.client("claude", ["mcp", "get", NAME]);
        expect(get.code, out(get)).toBe(0);
        const state = claudeGetStatus(get.stdout);
        // Claude Code does not start a project-scope server from .mcp.json until the folder's owner approves it:
        // that gate is the real client's own, so the health check there ends at its pending-approval state.
        const gated = scope === "project" && /approv|pending/i.test(state);
        if (!gated) {
          expect(state, get.stdout).toBe("connected");
          expect(made.npxCalls().length, "claude mcp get started the server through the npx stand-in").toBeGreaterThan(0);
        }

        expect(claudeEntry(made, scope)).toEqual({ type: "stdio", command: expected.command, args: expected.args, env: {} });

        const claudeCallsBefore = made.calls("claude").length;
        const again = await made.aca(["mcp", "install", ...flags]);
        expect(again.code, out(again)).toBe(0);
        expect(again.stdout).toContain("already registered");
        expect(made.calls("claude").length, "a repeated install must not call claude").toBe(claudeCallsBefore);

        const uninstall = await made.aca(["mcp", "uninstall", "--client", "claude-code", "--scope", scope, "--yes"]);
        expect(uninstall.code, out(uninstall)).toBe(0);
        const gone = await made.client("claude", ["mcp", "get", NAME]);
        expect(gone.code, "claude mcp get after uninstall").not.toBe(0);
        expect(statusRow((await made.aca(["mcp", "status", "--scope", scope])).stdout, "Claude Code")).toBe("not registered");

        expect(shimCallProblems("claude", made.callLines("claude"), made.home, { requireCalls: true })).toEqual([]);
        return state === "connected" ? "connected" : state.replace(/^other: /, "");
      });
    });
  }

  it("installs a pinned version and shows it in status", async (ctx) => {
    await check(ctx, "Claude Code", "user, --pin", "claude", MISSING, async () => {
      const made = sandbox();
      const install = await made.aca(["mcp", "install", "--client", "claude-code", "--scope", "user", "--pin", "--yes"]);
      expect(install.code, out(install)).toBe(0);
      expect(statusRow((await made.aca(["mcp", "status", "--scope", "user"])).stdout, "Claude Code")).toBe(`registered (pinned ${version})`);
      const get = await made.client("claude", ["mcp", "get", NAME]);
      expect(get.code, out(get)).toBe(0);
      expect(claudeGetStatus(get.stdout), get.stdout).toBe("connected");
      expect(get.stdout).toContain(`${NAME}@${version}`);
      const uninstall = await made.aca(["mcp", "uninstall", "--client", "claude-code", "--scope", "user", "--yes"]);
      expect(uninstall.code, out(uninstall)).toBe(0);
      return `pinned ${version}`;
    });
  });
});

describe.skipIf(!enabled)("VS Code (real code)", () => {
  it("writes the user mcp.json entry the real `code --add-mcp` writes", async (ctx) => {
    await check(ctx, "VS Code", "user", "code", "neither code nor code-insiders is on PATH", async () => {
      const made = sandbox();
      // VS Code is detected by its user folder; the real `code` is never given the real profile.
      const profile = path.join(made.home, ".config", "Code", "User");
      mkdirSync(profile, { recursive: true });
      const install = await made.aca(["mcp", "install", "--client", "vscode", "--yes"]);
      expect(install.code, out(install)).toBe(0);
      const ours = readJson(path.join(profile, "mcp.json")).servers?.[NAME];
      expect(ours, "our install wrote a servers entry").toBeDefined();

      const dataDir = path.join(made.root, "code-user-data");
      const setup = clientSetup("vscode", { version, pin: false, projectBillingDetails: false, platform: "linux", scope: "user" });
      const json = JSON.stringify({ name: NAME, ...(setup.json?.entry ?? {}) });
      let real: Awaited<ReturnType<Sandbox["client"]>>;
      try {
        real = await made.client("code", ["--add-mcp", json, "--user-data-dir", dataDir, "--extensions-dir", path.join(made.root, "code-extensions")], made.project, VSCODE_TIMEOUT);
      } catch (error) {
        rows.push({ client: "VS Code", scope: "user", result: `skipped: real code did not finish headless within ${VSCODE_TIMEOUT / 1000} s` });
        ctx.skip(`real code did not finish headless within ${VSCODE_TIMEOUT / 1000} s: ${String(error)}`);
        return;
      }
      expect(real.code, out(real)).toBe(0);
      const realFile = path.join(dataDir, "User", "mcp.json");
      expect(existsSync(realFile), `real code wrote ${path.relative(made.root, realFile)}`).toBe(true);
      const problems = vscodeEntryProblems(
        { file: path.relative(path.join(made.home, ".config", "Code"), path.join(profile, "mcp.json")), entry: ours },
        { file: path.relative(dataDir, realFile), entry: readJson(realFile).servers?.[NAME] },
      );
      expect(problems).toEqual([]);
      expect(statusRow((await made.aca(["mcp", "status"])).stdout, "VS Code")).toBe("registered (latest)");
      return `${path.basename(tools.code ?? "code")}: same User/mcp.json path and servers entry`;
    });
  });
});

describe.skipIf(!enabled)("Gemini CLI (real gemini)", () => {
  it("installs through `gemini mcp add`, reads it back and uninstalls", async (ctx) => {
    await check(ctx, "Gemini CLI", "user", "gemini", "gemini is not on PATH", async () => {
      const made = sandbox();
      const flags = ["--client", "gemini", "--scope", "user", "--yes"];
      const install = await made.aca(["mcp", "install", ...flags]);
      expect(install.code, out(install)).toBe(0);
      const entry = readJson(path.join(made.home, ".gemini", "settings.json")).mcpServers?.[NAME];
      const expected = clientSetup("gemini", { version, pin: false, projectBillingDetails: false, platform: "linux", scope: "user" }).launch;
      expect(entry).toMatchObject({ command: expected.command, args: expected.args });
      expect(statusRow((await made.aca(["mcp", "status", "--scope", "user"])).stdout, "Gemini CLI")).toBe("registered (latest)");
      const uninstall = await made.aca(["mcp", "uninstall", ...flags]);
      expect(uninstall.code, out(uninstall)).toBe(0);
      expect(statusRow((await made.aca(["mcp", "status", "--scope", "user"])).stdout, "Gemini CLI")).toBe("not registered");
      expect(shimCallProblems("gemini", made.callLines("gemini"), made.home, { requireCalls: true })).toEqual([]);
    });
  });
});

describe.skipIf(!enabled)("Codex CLI (real codex)", () => {
  it("installs through `codex mcp add`, reads it back and leaves the file on uninstall", async (ctx) => {
    await check(ctx, "Codex CLI", "user", "codex", "codex is not on PATH", async () => {
      const made = sandbox();
      const flags = ["--client", "codex", "--yes"];
      const install = await made.aca(["mcp", "install", ...flags]);
      expect(install.code, out(install)).toBe(0);
      const file = path.join(made.home, ".codex", "config.toml");
      expect(readText(file), "codex wrote its config.toml").toContain(`[mcp_servers.${NAME}]`);
      expect(statusRow((await made.aca(["mcp", "status"])).stdout, "Codex CLI")).toBe("registered (latest)");
      const written = readText(file);
      const uninstall = await made.aca(["mcp", "uninstall", ...flags]);
      expect(uninstall.code, out(uninstall)).toBe(0);
      expect(uninstall.stdout).toContain("Codex has no remove command");
      expect(readText(file), "uninstall leaves codex's file alone").toBe(written);
      expect(shimCallProblems("codex", made.callLines("codex"), made.home, { requireCalls: true })).toEqual([]);
    });
  });
});

describe.skipIf(!enabled)("Claude Desktop", () => {
  it("has no real-client check", async (ctx) => {
    rows.push({ client: "Claude Desktop", scope: "user", result: "skipped: a GUI app; no program to run" });
    ctx.skip("Claude Desktop is a GUI app: there is no program to run a check against");
  });
});

describe.skipIf(enabled)("real-client check is off", () => {
  it("is skipped without REAL_CLIENTS=1", (ctx) => {
    ctx.skip("set REAL_CLIENTS=1 (npm run test:real-clients:mcp-setup does)");
  });
});
