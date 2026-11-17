// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { TerminalName } from "./terminal-layout.mts";
import type { TerminalAction } from "./terminal-scenes.mts";

export interface BrowserDeps {
  // Resolves once the CLI's open call has reached the browser host `count` times.
  waitOpened(count: number): Promise<void>;
  analyzeClaudeCode(): Promise<void>;
  show(): Promise<void>;
}
export interface TerminalDeps {
  raise(terminal: TerminalName): Promise<void>;
  type(text: string): Promise<void>;
  press(key: string): Promise<void>;
  waitHealth(): Promise<void>;
  waitTemplate(template: string): Promise<void>;
  startRecording(): Promise<void>;
  browser: BrowserDeps;
}

export function createTerminalRunner(deps: TerminalDeps): { perform(action: TerminalAction): Promise<void> } {
  let opens = 0;
  return {
    async perform(action) {
      switch (action.kind) {
        case "showTerminal":
          return deps.raise(action.terminal);
        case "type":
          await deps.type(action.text);
          return deps.press("Return");
        case "waitHealth":
          return deps.waitHealth();
        case "waitTemplate":
          return deps.waitTemplate(action.template);
        case "startRecording":
          return deps.startRecording();
        case "waitBrowser":
          return deps.browser.waitOpened(++opens);
        case "analyzeClaudeCode":
          return deps.browser.analyzeClaudeCode();
        case "showBrowser":
          await deps.browser.waitOpened(++opens);
          return deps.browser.show();
        case "beat":
          return;
      }
    },
  };
}
