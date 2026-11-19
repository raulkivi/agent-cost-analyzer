// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodeBlock } from "./CodeBlock.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function renderBlock(copy: (text: string) => Promise<void>) {
  return render(<CodeBlock text={'{\n  "a": 1\n}'} label="Setup JSON for Cursor" copyLabel="setup JSON" copy={copy} />);
}

describe("CodeBlock", () => {
  it("shows the text in a focusable, named block that keeps its line breaks", () => {
    renderBlock(vi.fn());

    const block = screen.getByRole("group", { name: "Setup JSON for Cursor" });
    expect(block.tagName).toBe("PRE");
    expect(block).toHaveAttribute("tabindex", "0");
    expect(block.textContent).toBe('{\n  "a": 1\n}');
  });

  it("copies the text, says Copied for two seconds, then goes back", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    renderBlock(copy);
    const button = screen.getByRole("button", { name: "Copy: setup JSON" });

    await act(async () => fireEvent.click(button));

    expect(copy).toHaveBeenCalledWith('{\n  "a": 1\n}');
    expect(button).toHaveTextContent("Copied");
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
    expect(button).toHaveAccessibleName("Copied: setup JSON");

    act(() => void vi.advanceTimersByTime(2000));

    expect(button).toHaveTextContent("Copy");
    expect(button).not.toHaveTextContent("Copied");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("selects the text and says Press Ctrl+C to copy when the clipboard fails", async () => {
    renderBlock(vi.fn().mockRejectedValue(new Error("denied")));

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy: setup JSON" })));

    expect(screen.getAllByText("Press Ctrl+C to copy").length).toBeGreaterThan(0);
    expect(window.getSelection()?.toString()).toContain('"a": 1');
    expect(screen.getByRole("button", { name: "Copy: setup JSON" })).toHaveTextContent("Copy");
  });

  it("treats a missing clipboard (a synchronous throw) as a failure too", async () => {
    renderBlock(() => {
      throw new TypeError("clipboard is undefined");
    });

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy: setup JSON" })));

    expect(screen.getAllByText("Press Ctrl+C to copy").length).toBeGreaterThan(0);
  });
});
