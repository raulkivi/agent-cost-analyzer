// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

export interface CmdInvocation {
  file: string;
  args: string[];
  verbatim: true;
}

// Every argv token the setup commands build fits this set. cmd.exe gives
// none of these characters a meaning, so passing them unescaped is safe.
const SAFE_ARG = /^[A-Za-z0-9@._:/=+,-]+$/;

export function isSafeCmdArg(arg: string): boolean {
  return SAFE_ARG.test(arg);
}

/**
 * Node refuses to execFile a .cmd or .bat shim (npm's claude.cmd and the
 * like) without a shell. Run cmd.exe on one verbatim line instead, but only
 * when no argument could be read as cmd syntax.
 */
export function cmdInvocation(
  shim: string,
  args: readonly string[],
): CmdInvocation | { error: string } {
  const unsafe = args.find((arg) => !isSafeCmdArg(arg));
  if (unsafe !== undefined)
    return {
      error: `Refusing to run ${shim} through cmd.exe: the argument "${unsafe}" has characters cmd.exe would interpret. Run "agent-cost-analyzer mcp config" and paste the command yourself.`,
    };
  // %VAR% expands even inside quotes, and a quote ends them.
  if (/["%]/.test(shim))
    return {
      error: `Refusing to run ${shim} through cmd.exe: its path contains a quote or percent sign. Run "agent-cost-analyzer mcp config" and paste the command yourself.`,
    };
  // With /s, cmd strips the outermost quotes of the line.
  const line = `"${[`"${shim}"`, ...args].join(" ")}"`;
  return { file: "cmd.exe", args: ["/d", "/s", "/c", line], verbatim: true };
}
