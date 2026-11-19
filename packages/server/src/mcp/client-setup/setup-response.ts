// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { posix } from "node:path";
import type {
  McpSetupClient,
  McpSetupClientId,
  McpSetupResponse,
} from "@agent-cost-analyzer/domain";
import { MCP_CLIENT_IDS, clientSetup, type ClientSetup, type McpClientId } from "./client-setup.js";
import {
  claudeDesktopConfigPath,
  cursorUserConfigPath,
  vscodeConfigPath,
  vscodeInsidersConfigPath,
  type PathEnv,
} from "./config-paths.js";
import { shellLine } from "./shell-quote.js";

const LABELS: Record<McpClientId, string> = {
  "claude-code": "Claude Code",
  "claude-desktop": "Claude Desktop",
  cursor: "Cursor",
  vscode: "VS Code",
  "vscode-insiders": "VS Code Insiders",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
};

type FileClient = "claude-desktop" | "cursor" | "vscode" | "vscode-insiders";

const CONFIG_PATHS: Record<FileClient, (env: PathEnv) => string> = {
  "claude-desktop": claudeDesktopConfigPath,
  cursor: cursorUserConfigPath,
  vscode: vscodeConfigPath,
  "vscode-insiders": vscodeInsidersConfigPath,
};

// XDG_CONFIG_HOME relative to home as `~/...`, or undefined when it is not
// an absolute path inside home: an outside folder would show its own name.
function xdgUnderHome(xdg: string | undefined, home: string): string | undefined {
  if (!xdg || !posix.isAbsolute(xdg)) return undefined;
  const rel = posix.relative(home, xdg);
  if (rel.startsWith("..") || posix.isAbsolute(rel)) return undefined;
  return posix.join("~", rel);
}

/**
 * The config file's path for display. It is built by the real path rules
 * over a stand-in home (`~`, `%USERPROFILE%`, `%APPDATA%`), so the user's
 * absolute home and name cannot reach the response.
 */
export function displayConfigPath(client: FileClient, real: PathEnv): string {
  const windows = real.platform === "win32";
  return CONFIG_PATHS[client]({
    platform: real.platform,
    home: windows ? "%USERPROFILE%" : "~",
    env: windows
      ? { APPDATA: "%APPDATA%" }
      : { XDG_CONFIG_HOME: xdgUnderHome(real.env.XDG_CONFIG_HOME, real.home) },
  });
}

// The whole file a user would create or merge into: the entry under its keys.
function wholeFileJson(plan: NonNullable<ClientSetup["json"]>): string {
  const inner = { [plan.name]: plan.entry };
  const file = plan.keyPath.reduceRight<Record<string, unknown>>((acc, key) => ({ [key]: acc }), inner);
  return JSON.stringify(file, null, 2);
}

// A file the user can edit beats a command: VS Code has both, and a user
// scope Claude Code entry has no file (only project scope does).
function manualFor(id: McpClientId, setup: ClientSetup, env: PathEnv): McpSetupClient["manual"] {
  if (setup.json) {
    return { kind: "json", path: displayConfigPath(id as FileClient, env), json: wholeFileJson(setup.json) };
  }
  return { kind: "command", command: shellLine(setup.command ?? []) };
}

/** Pure: what the "Connect an agent" panel shows. Reads nothing, writes nothing. */
export function mcpSetupResponse(o: PathEnv & { version: string }): McpSetupResponse {
  const clients = MCP_CLIENT_IDS.map((id): McpSetupClient => {
    const setup = clientSetup(id, {
      version: o.version,
      pin: false,
      projectBillingDetails: false,
      platform: o.platform,
      scope: "user",
    });
    return {
      id: id satisfies McpSetupClientId,
      label: LABELS[id],
      installCommand: `npx agent-cost-analyzer mcp install --client ${id}`,
      manual: manualFor(id, setup, o),
      ...(setup.installLink && { installLink: setup.installLink }),
    };
  });
  return { version: o.version, clients };
}
