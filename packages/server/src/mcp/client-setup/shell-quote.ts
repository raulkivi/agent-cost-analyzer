// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

const BARE = /^[A-Za-z0-9@._:/=+,%-]+$/;

/** For display only: nothing in the CLI ever passes this text to a shell. */
export function shellQuote(arg: string): string {
  if (BARE.test(arg)) return arg;
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

export function shellLine(argv: readonly string[]): string {
  return argv.map(shellQuote).join(" ");
}
