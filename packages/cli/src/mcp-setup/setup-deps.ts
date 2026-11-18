// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ClientEnv } from "./client-env.js";
import type { CommandRunner } from "./command-runner.js";
import type { ConfigFileStore } from "./config-file-store.js";
import type { McpClientTarget } from "./mcp-client-target.js";

export interface SetupIo {
  out(text: string): void;
  err(text: string): void;
  /** stdin and stdout are both terminals: prompting is possible. */
  interactive: boolean;
  confirm(question: string): Promise<boolean>;
}

/** Everything the setup commands touch, injected (DIP) so tests need no real client. */
export interface SetupDeps {
  targets: readonly McpClientTarget[];
  store: ConfigFileStore;
  runner: CommandRunner;
  env: ClientEnv;
  /** The running package version, for `--pin`. */
  version: string;
  io: SetupIo;
}

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;
