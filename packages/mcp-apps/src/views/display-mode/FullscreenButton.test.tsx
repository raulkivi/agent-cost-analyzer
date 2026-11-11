// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DisplayMode } from "../../host/app-host-port.js";
import { axeViolations } from "../../test-support/axe.js";
import { FullscreenButton } from "./FullscreenButton.js";

// A14 (docs/plans/mcp-apps.md §7): the control is a native button, named by
// its visible label, reachable by Tab, and it keeps focus when the label
// changes. Visibility is decided by the caller (the host must list fullscreen).

function Harness({ initial = "inline", onToggle }: { initial?: DisplayMode; onToggle: () => Promise<void> }) {
  const [mode, setMode] = useState<DisplayMode>(initial);
  return (
    <>
      <button type="button">Before</button>
      <FullscreenButton
        mode={mode}
        onToggle={async () => {
          await onToggle();
          setMode(mode === "fullscreen" ? "inline" : "fullscreen");
        }}
      />
    </>
  );
}

describe("FullscreenButton", () => {
  it("is named Fullscreen outside fullscreen and Exit fullscreen inside it", () => {
    const { unmount } = render(<FullscreenButton mode="inline" onToggle={async () => undefined} />);
    expect(screen.getByRole("button", { name: "Fullscreen" })).toBeInTheDocument();
    unmount();
    render(<FullscreenButton mode="fullscreen" onToggle={async () => undefined} />);
    expect(screen.getByRole("button", { name: "Exit fullscreen" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fullscreen" })).toBeNull();
  });

  it("calls onToggle once per press", async () => {
    const onToggle = vi.fn(async () => undefined);
    render(<FullscreenButton mode="inline" onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("follows the mode: the label changes after the switch and focus stays on the control", async () => {
    const onToggle = vi.fn(async () => undefined);
    render(<Harness onToggle={onToggle} />);
    const control = screen.getByRole("button", { name: "Fullscreen" });
    await userEvent.click(control);
    const exit = await screen.findByRole("button", { name: "Exit fullscreen" });
    expect(exit).toBe(control);
    await waitFor(() => expect(document.activeElement).toBe(exit));
  });

  it("works from the keyboard: Tab reaches it, Enter and Space press it", async () => {
    const onToggle = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<Harness onToggle={onToggle} />);
    await user.tab();
    await user.tab();
    const control = screen.getByRole("button", { name: "Fullscreen" });
    expect(document.activeElement).toBe(control);
    await user.keyboard("{Enter}");
    expect(onToggle).toHaveBeenCalledTimes(1);
    await user.keyboard(" ");
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("has no axe violations in either mode", async () => {
    const { container, unmount } = render(<FullscreenButton mode="inline" onToggle={async () => undefined} />);
    expect(await axeViolations(container)).toEqual([]);
    unmount();
    const exit = render(<FullscreenButton mode="fullscreen" onToggle={async () => undefined} />);
    expect(await axeViolations(exit.container)).toEqual([]);
  });
});
