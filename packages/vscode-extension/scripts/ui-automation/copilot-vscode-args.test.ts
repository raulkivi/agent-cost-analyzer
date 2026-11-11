// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { COPILOT_E2E_PASSWORD_STORE, COPILOT_E2E_VSCODE_ARGS, copilotSignInArgs, renderVscodeArgs } from "./copilot-vscode-args.mts";

describe("VS Code arguments of the real-Copilot suite and its sign-in script", () => {
  it("keeps the sign-in in the basic password store, not the OS keyring", () => {
    expect(COPILOT_E2E_PASSWORD_STORE).toBe("basic");
  });

  it("renders an argument with a value as --key=value and a true flag as --key, as wdio-vscode-service does", () => {
    expect(renderVscodeArgs({ "password-store": "basic", "disable-renderer-backgrounding": true })).toEqual([
      "--password-store=basic",
      "--disable-renderer-backgrounding",
    ]);
  });

  it("starts the suite's VS Code with the password store the sign-in wrote to, so it can decrypt the sign-in", () => {
    const suite = renderVscodeArgs(COPILOT_E2E_VSCODE_ARGS);
    const signIn = copilotSignInArgs("/profile/user-data");

    expect(suite).toContain(`--password-store=${COPILOT_E2E_PASSWORD_STORE}`);
    expect(signIn).toContain(`--password-store=${COPILOT_E2E_PASSWORD_STORE}`);
    expect(signIn.filter((arg) => arg.startsWith("--password-store"))).toEqual(suite.filter((arg) => arg.startsWith("--password-store")));
  });

  it("draws the suite on X11, so under xvfb-run it stays off a Wayland desktop (Electron prefers WAYLAND_DISPLAY otherwise)", () => {
    expect(renderVscodeArgs(COPILOT_E2E_VSCODE_ARGS)).toContain("--ozone-platform=x11");
  });

  it("opens the sign-in on the throwaway profile, with its extensions next to it, and waits for the window to close", () => {
    expect(copilotSignInArgs("/profile/user-data")).toEqual([
      "--user-data-dir=/profile/user-data",
      "--extensions-dir=/profile/extensions",
      "--password-store=basic",
      "--no-sandbox",
      "--wait",
    ]);
  });
});
