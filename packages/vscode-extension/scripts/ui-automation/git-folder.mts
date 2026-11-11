// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// A real git repository with a made-up remote, for the real-Copilot suite's
// workspace (step 10.17 G7, check 1.14): the analyzer derives the repository
// of a Copilot chat from the workspace folder's `origin`. The remote is never
// contacted; the folder has no commits.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

export const E2E_REMOTE = "https://github.com/aica-e2e/demo.git";
// What the Sessions view and the status bar call that remote.
export const E2E_REPOSITORY = { key: "github.com/aica-e2e/demo", name: "demo" } as const;

export function createGitFolder(dir: string, remote: string): void {
  mkdirSync(dir, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
  git("init", "--quiet", "--initial-branch=main");
  git("remote", "add", "origin", remote);
}
