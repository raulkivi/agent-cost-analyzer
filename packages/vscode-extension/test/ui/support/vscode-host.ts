// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The one port the specs use to reach VS Code itself (step 10.16): commands,
// settings, the extension's Test-mode hooks, the active editor and the
// clipboard. The wdio adapter below runs each call inside the workbench with
// `browser.executeWorkbench`; a Playwright adapter would implement the same
// interface, so specs and page objects don't change.
import { browser } from "@wdio/globals";
import { INTERNAL_COMMAND_IDS } from "../../../src/diagnostics/test-hooks.js";
import { parseUiFixture, UI_FIXTURE_ENV } from "./ui-fixture-env.mts";
import { walkthroughAlreadyOffered } from "./walkthrough-state.js";

export interface ActiveEditorState {
  scheme: string | undefined;
  isDirty: boolean | undefined;
  text: string | undefined;
}

export interface VscodeHost {
  command<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  // A Test-mode hook (diagnostics/test-hooks.ts).
  hook<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  // Writes a user (global) setting; undefined removes it.
  setSetting(key: string, value: unknown): Promise<void>;
  setting<T = unknown>(key: string): Promise<T | undefined>;
  activeEditor(): Promise<ActiveEditorState>;
  clipboardText(): Promise<string>;
  // Resolves once the extension has registered its commands, and (unless
  // `keepStartupEditors`) has cleared the start-up Welcome tab away. `userDataDir`
  // is the launch's own profile, for telling whether a Welcome tab is due (the
  // main launch's when omitted, else none known: the tab is waited for). A spec
  // that checks what the first run opens (check 1.1) keeps it.
  waitForExtension(options?: { keepStartupEditors?: boolean; userDataDir?: string }): Promise<void>;
  // For launches where the analyzer is installed, not under development (no
  // Test-mode hooks): resolves once the workbench answers.
  waitForWorkbench(): Promise<void>;
  // Registered commands that start with `prefix`.
  commandsWithPrefix(prefix: string): Promise<string[]>;
  // The ids of the extensions the extension host runs, whose id starts with `prefix` (any case).
  extensionIds(prefix: string): Promise<string[]>;
}

export const wdioVscodeHost: VscodeHost = {
  async command(id, ...args) {
    return browser.executeWorkbench((vscode, commandId: string, commandArgs: unknown[]) => vscode.commands.executeCommand(commandId, ...commandArgs), id, args) as never;
  },
  async hook(id, ...args) {
    return this.command(id, ...args);
  },
  async setSetting(key, value) {
    await browser.executeWorkbench(
      async (vscode, settingKey: string, settingValue: unknown) => {
        const dot = settingKey.lastIndexOf(".");
        const section = settingKey.slice(0, dot);
        const name = settingKey.slice(dot + 1);
        await vscode.workspace.getConfiguration(section).update(name, settingValue, vscode.ConfigurationTarget.Global);
      },
      key,
      value,
    );
  },
  async setting(key) {
    return browser.executeWorkbench((vscode, settingKey: string) => {
      const dot = settingKey.lastIndexOf(".");
      return vscode.workspace.getConfiguration(settingKey.slice(0, dot)).get(settingKey.slice(dot + 1));
    }, key) as never;
  },
  async activeEditor() {
    return browser.executeWorkbench((vscode) => {
      const document = vscode.window.activeTextEditor?.document;
      return { scheme: document?.uri.scheme, isDirty: document?.isDirty, text: document?.getText() };
    });
  },
  async clipboardText() {
    return browser.executeWorkbench((vscode) => vscode.env.clipboard.readText());
  },
  async waitForWorkbench() {
    await browser.waitUntil(
      async () => {
        try {
          await (await browser.getWorkbench()).getStatusBar().getItems();
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 60_000, timeoutMsg: "the workbench did not come up" },
    );
  },
  async commandsWithPrefix(prefix) {
    return browser.executeWorkbench(async (vscode, wanted: string) => (await vscode.commands.getCommands(true)).filter((id: string) => id.startsWith(wanted)), prefix);
  },
  async extensionIds(prefix) {
    return browser.executeWorkbench((vscode, wanted: string) => vscode.extensions.all.map((extension: { id: string }) => extension.id).filter((id: string) => id.toLowerCase().startsWith(wanted.toLowerCase())), prefix);
  },
  async waitForExtension(options = {}) {
    await browser.waitUntil(
      async () => {
        try {
          await this.hook(INTERNAL_COMMAND_IDS.sessionsTree);
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 60_000, timeoutMsg: "the extension did not register its commands" },
    );
    // A fresh VS Code opens a Welcome tab (the Get Started walkthrough) a
    // moment after start-up, taking the editor group and the keyboard focus,
    // later when the machine is slow. Wait for it (a start without one costs
    // the timeout), then close it, so specs begin from an empty editor area.
    // Once per launch (a spec file is one launch): a later call, from a
    // spec's setup, must not close the panel a test has just opened.
    if (options.keepStartupEditors === true || startupSettled) return;
    startupSettled = true;
    const workbench = await browser.getWorkbench();
    const userDataDir = options.userDataDir ?? (process.env[UI_FIXTURE_ENV] ? parseUiFixture(process.env[UI_FIXTURE_ENV]).userDataDir : undefined);
    if (userDataDir === undefined || !walkthroughAlreadyOffered(userDataDir)) {
      await browser
        .waitUntil(async () => (await workbench.getEditorView().getOpenEditorTitles()).length > 0, { timeout: 20_000, interval: 500 })
        .catch(() => undefined);
    }
    await this.command("workbench.action.closeAllEditors");
    // The Chat view on the right (secondary side bar) takes a fifth of the
    // window; close it so the panel's room doesn't depend on the runner.
    await this.command("workbench.action.closeAuxiliaryBar");
  },
};

let startupSettled = false;
