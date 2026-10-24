import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { INTEGRATION_FIXTURE_ENV } from "./integration-fixture-env.mts";
import { integrationTestBundleOptions, integrationTestEntryPoints } from "./integration-test-options.mts";

// The mocha TDD globals the suite registers itself with, recorded instead of run.
const MOCHA_GLOBALS = ["suite", "test", "suiteSetup", "suiteTeardown", "setup", "teardown"] as const;

// The real-VS Code suite can't run here (no VS Code download), so this
// checks the next best thing: that it bundles the way @vscode/test-cli
// loads it — one CommonJS file per test file under out/integration/, with
// `vscode` (and mocha's globals) left to the Extension Development Host —
// and that loading a bundle registers its suites without throwing (e.g. on
// an import.meta.url a CJS bundle doesn't have).
describe("the integration-test bundle (step 10.9)", () => {
  let outDir: string;
  let installDir: string;

  beforeAll(async () => {
    installDir = mkdtempSync(path.join(tmpdir(), "aica-itest-bundle-"));
    outDir = path.join(installDir, "out", "integration");
    await build({ ...integrationTestBundleOptions(outDir), logLevel: "silent" });
    mkdirSync(path.join(installDir, "node_modules", "vscode"), { recursive: true });
    writeFileSync(path.join(installDir, "node_modules", "vscode", "index.js"), "module.exports = { stub: true };");
  }, 60_000);

  afterAll(() => {
    rmSync(installDir, { recursive: true, force: true });
  });

  it("finds the suite's test files under src/test/integration", () => {
    const entries = integrationTestEntryPoints().map((entry) => path.basename(entry));

    expect(entries).toContain("extension.test.ts");
    expect(entries.every((entry) => entry.endsWith(".test.ts"))).toBe(true);
  });

  it("writes one CommonJS bundle per test file, where @vscode/test-cli's files glob looks", () => {
    const options = integrationTestBundleOptions(outDir);

    expect(options).toMatchObject({ format: "cjs", platform: "node", bundle: true, external: ["vscode"] });
    expect(readdirSync(outDir).filter((file) => file.endsWith(".test.js")).sort()).toEqual(
      integrationTestEntryPoints()
        .map((entry) => path.basename(entry).replace(/\.ts$/, ".js"))
        .sort(),
    );
  });

  it("loads in Node with a stub `vscode`, registering its suites and tests", () => {
    const registered: string[] = [];
    const saved = new Map<string, unknown>();
    const globals = globalThis as Record<string, unknown>;
    const previousFixture = process.env[INTEGRATION_FIXTURE_ENV];
    for (const name of MOCHA_GLOBALS) {
      saved.set(name, globals[name]);
      globals[name] = (title: unknown, body?: unknown) => {
        if (typeof title === "string") registered.push(`${name}: ${title}`);
        // A suite's body declares its tests; run it with mocha's `this`.
        if (name === "suite" && typeof body === "function") body.call({ timeout: () => undefined });
      };
    }
    process.env[INTEGRATION_FIXTURE_ENV] = JSON.stringify({
      userDataDir: path.join(installDir, "user-data"),
      usageSessionId: "1c7604a0-1488-4b5d-880a-f80fd693475e",
      usageSessionTitle: "Fix the bug",
      sessionCount: 200,
    });
    try {
      const requireFromInstall = createRequire(path.join(installDir, "package.json"));
      requireFromInstall(path.join(outDir, "extension.test.js"));
    } finally {
      for (const [name, value] of saved) globals[name] = value;
      if (previousFixture === undefined) delete process.env[INTEGRATION_FIXTURE_ENV];
      else process.env[INTEGRATION_FIXTURE_ENV] = previousFixture;
    }

    expect(registered).toEqual(
      expect.arrayContaining([
        "suite: AI Credits Analyzer in a real VS Code (step 10.9)",
        "suite: MCP server (D7, carried over from 10.8)",
        expect.stringMatching(/^test: meets the §3\.5 budgets/),
        expect.stringMatching(/^test: with the setting on, offers one server/),
      ]),
    );
    expect(registered.filter((entry) => entry.startsWith("test: "))).toHaveLength(7);
  });
});
