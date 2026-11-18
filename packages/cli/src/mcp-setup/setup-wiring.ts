// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { createInterface } from "node:readline/promises";
import { createClientEnv } from "./client-env.js";
import { createClientTargets } from "./client-targets.js";
import { createConfigFileStore } from "./config-file-store.js";
import { createCommandRunner } from "./exec-command-runner.js";
import { createSetupRunner, type SetupRunner } from "./setup-runner.js";

async function askYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

/** The real machine behind the setup commands: this home, PATH and terminal. */
export function createSetup(io: {
  version: string;
  stdout(text: string): void;
  stderr(text: string): void;
}): SetupRunner {
  const store = createConfigFileStore();
  return createSetupRunner({
    targets: createClientTargets({ store }),
    store,
    runner: createCommandRunner(),
    env: createClientEnv(),
    version: io.version,
    io: {
      out: io.stdout,
      err: io.stderr,
      interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
      confirm: askYesNo,
    },
  });
}
