// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ConfigFileStats } from "./config-limits.js";

/**
 * The part of `node:fs/promises` the config writer uses, injected so tests
 * can make one call fail (a rename, a half-finished write) over a real
 * folder. `node:fs/promises` itself satisfies it.
 */
export interface ConfigFs {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(
    path: string,
    data: string,
    options: { mode: number; flag: "wx" },
  ): Promise<void>;
  copyFile(source: string, destination: string, mode?: number): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  stat(path: string): Promise<{ mode: number } & ConfigFileStats>;
  realpath(path: string): Promise<string>;
  readlink(path: string): Promise<string>;
}

export function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}
