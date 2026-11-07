// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SKELETON_DELAY_MS } from "../ui/AsyncView.js";
import { ReplayStatus } from "./ReplayStatus.js";

const base = { model: "claude-sonnet-5.5", onCancel: vi.fn(), onRetry: vi.fn() };

describe("ReplayStatus (step 14.7, board 4)", () => {
  afterEach(() => vi.useRealTimers());

  it("invites a choice while replay is off", () => {
    render(<ReplayStatus {...base} status="idle" />);
    expect(screen.getByText(/Choose a model in Replay on to see what this session would have cost there/)).toBeInTheDocument();
  });

  it("4b: shows loading after 300 ms, with Cancel", async () => {
    vi.useFakeTimers();
    const onCancel = vi.fn();
    render(<ReplayStatus {...base} onCancel={onCancel} status="loading" />);
    act(() => vi.advanceTimersByTime(SKELETON_DELAY_MS));
    expect(screen.getByRole("progressbar", { name: "Replaying on claude-sonnet-5.5…" })).toBeInTheDocument();
    vi.useRealTimers();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("4c: a 404 says why the session can't be replayed, in the API's words, without Retry", () => {
    render(<ReplayStatus {...base} status="error" error="This provider's logs can't be replayed yet." errorStatus={404} />);
    expect(screen.getByRole("status")).toHaveTextContent("This session can't be replayed");
    expect(screen.getByRole("status")).toHaveTextContent("This provider's logs can't be replayed yet.");
    expect(screen.getByRole("status")).toHaveTextContent("Its measured figures are unchanged.");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("4f: another error keeps its message, with Try again", async () => {
    const onRetry = vi.fn();
    render(<ReplayStatus {...base} onRetry={onRetry} status="error" error="network error: connection refused" />);
    expect(screen.getByText("Couldn't replay on claude-sonnet-5.5")).toBeInTheDocument();
    expect(screen.getByText(/network error: connection refused/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows nothing once the replay is ready", () => {
    const { container } = render(<ReplayStatus {...base} status="ready" />);
    expect(container).toBeEmptyDOMElement();
  });
});
