// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Packs the real package and the alias, installs both tarballs with no
// registry, and runs the alias (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/npm-package.md D3, §4.8). Needs `npm run
// build` first, as the cli's own bundle test does.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aliasProblems, packWorkspace } from "../../cli/smoke/alias.mts";
import { isolatedEnv } from "../../cli/smoke/processes.mts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const MINUTE = 60_000;
const readVersion = (workspace: string) => (JSON.parse(readFileSync(path.join(repoRoot, workspace, "package.json"), "utf8")) as { version: string }).version;

describe("the packed alias, installed next to the packed real package", () => {
  let temp = "";
  beforeAll(() => {
    if (!existsSync(path.join(repoRoot, "packages", "cli", "dist", "cli.js"))) throw new Error("packages/cli/dist is missing; run `npm run build` first");
    temp = mkdtempSync(path.join(tmpdir(), "aca-alias-test-"));
  });
  afterAll(() => rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }));

  it("answers --version, --help and an MCP initialize like the real package", async () => {
    const platform = process.platform;
    const pack = path.join(temp, "pack");
    const project = path.join(temp, "project");
    const home = path.join(temp, "home");
    for (const dir of [pack, project, home]) mkdirSync(dir, { recursive: true });
    const mainTarball = await packWorkspace(platform, repoRoot, "packages/cli", pack);
    const aliasTarball = await packWorkspace(platform, repoRoot, "packages/cli-alias", pack);
    const env = isolatedEnv(process.env, { home, npmCache: path.join(temp, "npm-cache"), platform });
    const problems = await aliasProblems({
      platform,
      project,
      env,
      mainTarball,
      aliasTarball,
      version: readVersion("packages/cli"),
      aliasVersion: readVersion("packages/cli-alias"),
      timeoutMs: 5 * MINUTE,
    });
    expect(problems).toEqual([]);
  }, 15 * MINUTE);
});
