// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ClientEnv } from "./client-env.js";
import {
  cursorUserConfigPath,
  geminiUserSettingsPath,
  pathFlavor,
} from "../../../server/src/mcp/client-setup/config-paths.js";

// The user-level rules live with the client-setup builders, which
// GET /api/mcp/setup also uses to show the same paths. Only the project
// scope, which needs the working folder, is the CLI's own.
export {
  claudeDesktopConfigPath,
  codexConfigPath,
  codexHome,
  geminiHome,
  pathFlavor,
  vscodeConfigPath,
  vscodeExtensionsDir,
  vscodeInsidersConfigPath,
  vscodeInsidersExtensionsDir,
  vscodeInsidersUserDir,
  vscodeUserDir,
} from "../../../server/src/mcp/client-setup/config-paths.js";

export function cursorConfigPath(
  scope: "user" | "project",
  env: ClientEnv,
): string {
  if (scope === "user") return cursorUserConfigPath(env);
  return pathFlavor(env.platform).join(env.cwd, ".cursor", "mcp.json");
}

export function geminiSettingsPath(
  scope: "user" | "project",
  env: ClientEnv,
): string {
  if (scope === "user") return geminiUserSettingsPath(env);
  return pathFlavor(env.platform).join(env.cwd, ".gemini", "settings.json");
}
