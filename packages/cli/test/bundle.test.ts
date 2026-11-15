// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The built package (`npm run build`): dist/cli.js runs `--version`, `serve`
// and `mcp` under plain Node (npm-package.md §7: CommonJS in the ESM bundle,
// import.meta.url paths), its notices cover every bundled npm package, and
// `npm pack` stays within the file list and size budget. Skipped locally
// before a build; CI builds first and sets CI, which turns a skip into a
// failure.
import { execFileSync, spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cliBuildPlan } from "../scripts/build-plan.mts";
import { packProblems, type PackReport } from "../scripts/pack-check.mts";
import { bundledPackageDirs, isAllowedLicense, readBundledPackage } from "../scripts/third-party-notices.mts";

const plan = cliBuildPlan(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".."));
const cliJs = path.join(plan.distDir, "cli.js");
const version = (JSON.parse(readFileSync(path.join(plan.packageDir, "package.json"), "utf8")) as { version: string }).version;
const inCi = !["", "0", "false"].includes(process.env.CI ?? "");

describe.runIf(existsSync(cliJs) || inCi)("the built npm package", () => {
  let home: string;
  const children: ChildProcessWithoutNullStreams[] = [];

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "cli-bundle-home-"));
  });
  afterEach(() => {
    for (const child of children.splice(0)) if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(home, { recursive: true, force: true });
  });

  // A fresh home, so the app reads no log or settings folder of this machine.
  const isolatedEnv = (): NodeJS.ProcessEnv => ({
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    APPDATA: path.join(home, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(home, "AppData", "Local"),
  });

  function start(...args: string[]): { child: ChildProcessWithoutNullStreams; lines: AsyncIterator<string>; stderr: () => string } {
    const child = spawn(process.execPath, [cliJs, ...args], { env: isolatedEnv(), stdio: "pipe" });
    children.push(child);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    return { child, lines, stderr: () => stderr };
  }

  async function nextLine(lines: AsyncIterator<string>, stderr: () => string): Promise<string> {
    const next = await lines.next();
    if (next.done === true) throw new Error(`stdout closed; stderr:\n${stderr()}`);
    return next.value;
  }

  const exited = (child: ChildProcessWithoutNullStreams) =>
    new Promise<number | null>((resolve) => (child.exitCode === null ? child.once("exit", (code) => resolve(code)) : resolve(child.exitCode)));

  const get = (port: number, urlPath: string) =>
    new Promise<{ status: number; type: string; body: string }>((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port, path: urlPath, agent: false }, (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"]), body }));
      });
      req.on("error", reject);
      req.end();
    });

  it("is built (run `npm run build` first)", () => {
    expect(existsSync(cliJs), `${cliJs} is missing`).toBe(true);
  });

  it("prints the package version for --version, through the bin shim as well", () => {
    const shim = path.join(plan.packageDir, "bin", "agent-cost-analyzer.js");
    for (const entry of [cliJs, shim]) {
      const result = spawnSync(process.execPath, [entry, "--version"], { env: isolatedEnv(), encoding: "utf8" });
      // Node 22 warns that node:sqlite is experimental; only the shim filters
      // that warning, so dist/cli.js run directly may print it.
      const otherStderr = result.stderr
        .split("\n")
        .filter((line) => line !== "" && !/ExperimentalWarning: SQLite|--trace-warnings/.test(line));
      expect(entry === shim ? result.stderr : otherStderr.join("\n"), entry).toBe("");
      expect(result.status, entry).toBe(0);
      expect(result.stdout, entry).toBe(`${version}\n`);
    }
  });

  it("serves the API and the web app on the port it prints, then stops on SIGINT", async () => {
    const { child, lines, stderr } = start("--no-open", "--port", "0");
    const startLine = await nextLine(lines, stderr);
    const match = /^Agent Cost Analyzer (\S+) on http:\/\/127\.0\.0\.1:(\d+) \(Ctrl\+C to stop\)$/.exec(startLine);
    expect(match, `${startLine}\n${stderr()}`).not.toBeNull();
    expect(match?.[1]).toBe(version);
    const port = Number(match?.[2]);

    const health = await get(port, "/api/health");
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toMatchObject({ app: "agent-cost-analyzer", version });

    const index = await get(port, "/");
    expect(index.status).toBe(200);
    expect(index.type).toMatch(/^text\/html/);
    expect(index.body).toBe(readFileSync(path.join(plan.distDir, "web", "index.html"), "utf8"));

    child.kill("SIGINT");
    expect(await exited(child)).toBe(0);
  }, 30_000);

  it("answers MCP initialize and tools/list over stdio, with JSON-RPC alone on stdout", async () => {
    const { child, lines, stderr } = start("mcp");
    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const reply = async () => JSON.parse(await nextLine(lines, stderr)) as { jsonrpc: string; id?: number; result?: Record<string, unknown> };

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "bundle-test", version: "0" } },
    });
    const initialized = await reply();
    expect(initialized).toMatchObject({ jsonrpc: "2.0", id: 1, result: { serverInfo: { version } } });

    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const listed = await reply();
    expect(listed).toMatchObject({ jsonrpc: "2.0", id: 2 });
    const names = (listed.result?.tools as { name: string }[]).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["list_sessions", "get_session_cost", "list_tool_calls"]));

    child.stdin.end();
    expect(await exited(child)).toBe(0);
    for (let next = await lines.next(); next.done !== true; next = await lines.next()) {
      expect(JSON.parse(next.value)).toMatchObject({ jsonrpc: "2.0" });
    }
  }, 30_000);

  it("names every bundled npm package in THIRD-PARTY-NOTICES.md, each under an allowed license", () => {
    const metafile = JSON.parse(readFileSync(plan.metafilePath, "utf8")) as { inputs: Record<string, unknown> };
    const notices = readFileSync(plan.noticesPath, "utf8");
    const packages = bundledPackageDirs(metafile, plan.packageDir).map(readBundledPackage);
    expect(packages.length).toBeGreaterThan(0);
    for (const bundled of packages) {
      expect(notices, bundled.name).toContain(`| \`${bundled.name}\` | ${bundled.version} | ${bundled.license} |`);
      expect(isAllowedLicense(bundled.license), `${bundled.name}: ${bundled.license}`).toBe(true);
    }
  });

  it("packs only the expected files, within the size budget", () => {
    const repoRoot = path.resolve(plan.packageDir, "..", "..");
    const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--workspace=packages/cli"], {
      cwd: repoRoot,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    const [report] = JSON.parse(output) as PackReport[];
    expect(packProblems(report)).toEqual([]);
  }, 60_000);
});
