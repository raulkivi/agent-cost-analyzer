// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { execFile, type ExecFileException } from "node:child_process";
import { stat } from "node:fs/promises";
import { pathCandidates } from "./client-env.js";
import type { CommandResult, CommandRunner } from "./command-runner.js";
import { cmdInvocation } from "./windows-command.js";

const TIMEOUT_MS = 60_000;

export type ExecFn = (
  file: string,
  args: readonly string[],
  options: { verbatim: boolean },
) => Promise<CommandResult>;

/** No `shell: true` anywhere: argv goes to the program as an array. */
export const execFileCommand: ExecFn = (file, args, { verbatim }) =>
  new Promise((resolve) => {
    execFile(
      file,
      [...args],
      {
        timeout: TIMEOUT_MS,
        windowsHide: true,
        windowsVerbatimArguments: verbatim,
      },
      (error, _stdout, stderr) => resolve(toResult(file, error, stderr)),
    );
  });

function toResult(
  file: string,
  error: ExecFileException | null,
  stderr: string,
): CommandResult {
  if (!error) return { ok: true };
  if (error.code === "ENOENT")
    return { ok: false, message: `${file} was not found on PATH` };
  if (error.killed)
    return { ok: false, message: `timed out after ${TIMEOUT_MS / 1000} s` };
  const detail = stderr.trim();
  const exit = `exit code ${error.code ?? "unknown"}`;
  return { ok: false, message: detail ? `${exit}: ${detail}` : exit };
}

const isFile = (path: string) =>
  stat(path).then(
    (s) => s.isFile(),
    () => false,
  );

export interface CommandRunnerDeps {
  platform?: NodeJS.Platform;
  env?: Readonly<Record<string, string | undefined>>;
  exec?: ExecFn;
  isFile?: (path: string) => Promise<boolean>;
}

async function resolveOnWindows(
  file: string,
  deps: Required<CommandRunnerDeps>,
): Promise<string> {
  for (const candidate of pathCandidates(file, "win32", deps.env))
    if (await deps.isFile(candidate)) return candidate;
  return file;
}

export function createCommandRunner(
  deps: CommandRunnerDeps = {},
): CommandRunner {
  const resolved: Required<CommandRunnerDeps> = {
    platform: deps.platform ?? process.platform,
    env: deps.env ?? process.env,
    exec: deps.exec ?? execFileCommand,
    isFile: deps.isFile ?? isFile,
  };
  return {
    async run(file, args): Promise<CommandResult> {
      if (resolved.platform !== "win32")
        return resolved.exec(file, args, { verbatim: false });
      const target = await resolveOnWindows(file, resolved);
      if (!/\.(cmd|bat)$/i.test(target))
        return resolved.exec(target, args, { verbatim: false });
      const invocation = cmdInvocation(target, args);
      if ("error" in invocation)
        return { ok: false, message: invocation.error };
      return resolved.exec(invocation.file, invocation.args, {
        verbatim: true,
      });
    },
  };
}
