// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ClientEnv } from "../../src/mcp-setup/client-env.js";

export interface FakeEnvOptions extends Partial<ClientEnv> {
  /** Commands that resolve on PATH. */
  commands?: readonly string[];
  /** Paths that exist besides anything the test creates on disk. */
  paths?: readonly string[];
}

export function fakeEnv(opts: FakeEnvOptions = {}): ClientEnv {
  const { commands = [], paths = [], ...rest } = opts;
  const onPath = new Set(commands);
  const existing = new Set(paths);
  return {
    platform: "linux",
    home: "/home/u",
    cwd: "/work/proj",
    env: {},
    onPath: async (cmd) => onPath.has(cmd),
    exists: async (path) => existing.has(path),
    ...rest,
  };
}
