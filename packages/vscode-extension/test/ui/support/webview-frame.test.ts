// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { enterWebview, leaveWebview, type FrameDriver, type WebviewFrames } from "./webview-frame.js";

describe("webview frame switching", () => {
  it("enters the outer iframe, waits for the active frame, then enters it", async () => {
    const order: string[] = [];
    const driver: FrameDriver = { switchFrame: async (c) => void order.push(`switch:${String(c)}`) };
    const webview: WebviewFrames = {
      elem: "outer",
      activeFrame: {
        waitForExist: async () => void order.push("wait"),
        getElement: async () => "inner",
      },
    };
    await enterWebview(driver, webview);
    expect(order).toEqual(["switch:outer", "wait", "switch:inner"]);
  });

  it("leaves to the top-level context with a single null switch", async () => {
    const calls: unknown[] = [];
    await leaveWebview({ switchFrame: async (c) => void calls.push(c) });
    expect(calls).toEqual([null]);
  });
});
