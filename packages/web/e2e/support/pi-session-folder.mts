// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

/**
 * The folder pi keeps a project's sessions in: `--<cwd>--` with the leading
 * separator dropped and every `/`, `\` and `:` (a Windows drive) as `-`, so
 * it is one path segment on every OS.
 */
export function piSessionFolder(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}
