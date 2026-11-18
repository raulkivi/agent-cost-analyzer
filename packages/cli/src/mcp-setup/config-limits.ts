// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// Client configs are kilobytes; Claude Code's ~/.claude.json, which also
// keeps per-project history, stays well under this.
export const MAX_CONFIG_BYTES = 10 * 1024 * 1024;

export interface ConfigFileStats {
  size: number;
  isFile(): boolean;
}

/**
 * Why `path` must not be read as a config, or undefined when it may be.
 * A device such as `/dev/zero` behind the path would never finish reading.
 */
export function configFileRefusal(
  path: string,
  stats: ConfigFileStats,
): string | undefined {
  if (!stats.isFile()) return `${path} is not a regular file`;
  if (stats.size > MAX_CONFIG_BYTES)
    return `${path} is larger than 10 MB, too large for a config file`;
  return undefined;
}
