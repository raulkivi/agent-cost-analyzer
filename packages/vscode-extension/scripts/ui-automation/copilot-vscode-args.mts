// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// VS Code arguments shared by the real-Copilot suite (wdio.copilot.conf.mts)
// and its sign-in script (copilot-e2e-signin.mts), so they can't drift. The
// sign-in is encrypted with the password store VS Code ran with; a suite on
// another store (the OS keyring, reachable through D-Bus under xvfb-run) can't
// decrypt it and finds no GitHub account. Both use the basic store.
import path from "node:path";

export const COPILOT_E2E_PASSWORD_STORE = "basic";

// wdio-vscode-service's `vscodeArgs` for the suite.
export const COPILOT_E2E_VSCODE_ARGS: Readonly<Record<string, string | boolean>> = {
  "password-store": COPILOT_E2E_PASSWORD_STORE,
  // X11 only: under xvfb-run on a Wayland desktop, Electron would otherwise
  // follow WAYLAND_DISPLAY and open the window on the owner's screen.
  "ozone-platform": "x11",
  "disable-renderer-backgrounding": true,
  "disable-backgrounding-occluded-windows": true,
  "disable-features": "CalculateNativeWinOcclusion",
};

// As wdio-vscode-service renders `vscodeArgs`: `--key=value`, or `--key` for true.
export function renderVscodeArgs(args: Readonly<Record<string, string | boolean>>): string[] {
  return Object.entries(args).map(([key, value]) => (value === true ? `--${key}` : `--${key}=${String(value)}`));
}

export function copilotSignInArgs(userDataDir: string): string[] {
  return [
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${path.join(userDataDir, "..", "extensions")}`,
    ...renderVscodeArgs({ "password-store": COPILOT_E2E_PASSWORD_STORE }),
    "--no-sandbox",
    "--wait",
  ];
}
