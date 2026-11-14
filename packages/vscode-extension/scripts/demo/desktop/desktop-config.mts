// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
export type DesktopConfig = Record<string, unknown>;

export interface DesktopConfigOptions {
  serverScript: string;
  home: string;
  now: string;
}

// Desktop reads this file at launch. Only the analyzer may be listed, so a take never shows or calls another server.
export function buildDesktopConfig(existing: DesktopConfig | undefined, o: DesktopConfigOptions): DesktopConfig {
  return {
    ...existing,
    mcpServers: {
      "ai-credits-analyzer": {
        command: o.serverScript,
        env: {
          HOME: o.home,
          USERPROFILE: o.home,
          XDG_CONFIG_HOME: `${o.home}/.config`,
          AGENT_COST_ANALYZER_NOW: o.now,
        },
      },
    },
  };
}
