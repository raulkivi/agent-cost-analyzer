// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

export type CommandResult = { ok: true } | { ok: false; message: string };

/** Runs one external command; injected so the flow needs no real client. */
export interface CommandRunner {
  run(file: string, args: readonly string[]): Promise<CommandResult>;
}
