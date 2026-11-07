// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SessionPicker } from "../commands/extension-commands.js";
import type { SessionPickItem } from "../commands/session-pick-items.js";

// The slice of the `vscode` namespace the picker needs; extension.ts passes
// the real module, tests a fake.
export interface VscodeSessionPickerApi {
  window: {
    showQuickPick(
      items: SessionPickItem[],
      options: { placeHolder: string; matchOnDescription: boolean; matchOnDetail: boolean },
    ): PromiseLike<SessionPickItem | undefined>;
    showInformationMessage(message: string): PromiseLike<unknown>;
  };
}

// Thin adapter: the Open Session picker over VS Code's QuickPick. It matches
// on the description and detail as well as the title, so a pasted title, id
// or date finds its row.
export function createVscodeSessionPicker(vscode: VscodeSessionPickerApi): SessionPicker {
  return {
    async pick(items, placeholder) {
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: placeholder,
        matchOnDescription: true,
        matchOnDetail: true,
      });
      return picked?.sessionId;
    },
    inform(message) {
      void vscode.window.showInformationMessage(message);
    },
  };
}
