// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// What the npm-package smoke (run.mts) and the mcp-setup smoke
// (setup-run.mts) share: the step log, the step runner that stops at the
// first step with problems, and building and packing the CLI.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { nodeWarningLines } from "./checks.mts";
import { runToEnd } from "./io.mts";
import { invocation } from "./processes.mts";

export class StepFailed extends Error {}

export const MINUTE = 60_000;

export type Log = (line: string) => void;

/** Prints each line and keeps it in <outDir>/smoke.log. */
export function logger(outDir: string): Log {
  const file = path.join(outDir, "smoke.log");
  writeFileSync(file, "");
  return (line: string) => {
    process.stdout.write(`${line}\n`);
    writeFileSync(file, `${line}\n`, { flag: "a" });
  };
}

export async function step(log: Log, name: string, run: () => Promise<string[]> | string[]): Promise<void> {
  log(`- ${name}`);
  const problems = await run();
  if (problems.length > 0) {
    for (const problem of problems) log(`  FAIL ${problem}`);
    throw new StepFailed(name);
  }
  log("  ok");
}

export const exitProblems = (label: string, code: number | string, expected: number | string = 0): string[] =>
  code === expected ? [] : [`${label} ended with ${code}, expected ${expected}`];

export const warningProblems = (label: string, stderr: string): string[] => nodeWarningLines(stderr).map((line) => `${label} printed a Node warning: ${line}`);

/** npm run build, then npm pack of packages/cli into `packDir`; resolves to the tarball's path. */
export async function buildAndPack(platform: NodeJS.Platform, repoRoot: string, packDir: string): Promise<string> {
  const build = await runToEnd(invocation(platform, "npm", ["run", "build"]), { cwd: repoRoot, env: process.env, timeoutMs: 15 * MINUTE, echo: true });
  if (build.code !== 0) throw new Error(`npm run build ended with ${build.code}`);
  const pack = await runToEnd(invocation(platform, "npm", ["pack", "--workspace=packages/cli", "--pack-destination", packDir, "--json"]), {
    cwd: repoRoot,
    env: process.env,
    timeoutMs: 5 * MINUTE,
  });
  if (pack.code !== 0) throw new Error(`npm pack ended with ${pack.code}:\n${pack.stderr}`);
  const [report] = JSON.parse(pack.stdout) as { filename: string }[];
  return path.join(packDir, report!.filename);
}
