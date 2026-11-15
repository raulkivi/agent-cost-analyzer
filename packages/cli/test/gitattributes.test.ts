// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Git's autocrlf on a Windows checkout would give the bin shim CRLF line
// endings, and `#!/usr/bin/env node\r` does not run on macOS or Linux (NP8).
// .gitattributes pins LF for the files that ship and for scripts.
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);

const attribute = (file: string, name: string): string => {
  const out = execFileSync("git", ["check-attr", name, "--", file], { cwd: root, encoding: "utf8" });
  return out.trim().split(": ").pop() ?? "";
};

describe(".gitattributes", () => {
  it.each(["packages/cli/bin/agent-cost-analyzer.js", "packages/cli/bin/node-gate.js", "packages/cli/smoke/run.mts"])("checks out %s with LF", (file) => {
    expect(attribute(file, "eol")).toBe("lf");
  });
});
