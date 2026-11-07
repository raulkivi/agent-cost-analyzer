// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";
import { createVscodeSessionPicker, type VscodeSessionPickerApi } from "./vscode-session-picker.js";

const ITEMS = [{ label: "A", description: "d", detail: "id-a", sessionId: "id-a" }];

function fakeApi(pick: (typeof ITEMS)[number] | undefined) {
  return {
    window: {
      showQuickPick: vi.fn<VscodeSessionPickerApi["window"]["showQuickPick"]>(async () => pick),
      showInformationMessage: vi.fn(async () => undefined),
    },
  };
}

describe("createVscodeSessionPicker", () => {
  it("shows a QuickPick matching on description and detail, and returns the picked session id", async () => {
    const api = fakeApi(ITEMS[0]);

    const id = await createVscodeSessionPicker(api).pick(ITEMS, "Pick a session");

    expect(id).toBe("id-a");
    expect(api.window.showQuickPick).toHaveBeenCalledWith(ITEMS, {
      placeHolder: "Pick a session",
      matchOnDescription: true,
      matchOnDetail: true,
    });
  });

  it("returns undefined when the user cancels", async () => {
    expect(await createVscodeSessionPicker(fakeApi(undefined)).pick(ITEMS, "p")).toBeUndefined();
  });

  it("shows a message without waiting for it to be dismissed", () => {
    const api = fakeApi(undefined);

    createVscodeSessionPicker(api).inform("No sessions");

    expect(api.window.showInformationMessage).toHaveBeenCalledWith("No sessions");
  });
});
