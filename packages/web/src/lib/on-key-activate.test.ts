// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { KeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { onKeyActivate } from "./on-key-activate.js";

function keyEvent(key: string) {
  return { key, preventDefault: vi.fn() } as unknown as KeyboardEvent;
}

describe("onKeyActivate", () => {
  it("calls the handler and prevents default on Enter", () => {
    const handler = vi.fn();
    const event = keyEvent("Enter");

    onKeyActivate(handler)(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("calls the handler and prevents default on Space", () => {
    const handler = vi.fn();
    const event = keyEvent(" ");

    onKeyActivate(handler)(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys", () => {
    const handler = vi.fn();
    const event = keyEvent("Tab");

    onKeyActivate(handler)(event);

    expect(handler).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
