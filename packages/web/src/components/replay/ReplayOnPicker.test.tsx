// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { REPLAY_PROFILES } from "../../test-support/replay-fixture.js";
import { ReplayOnPicker } from "./ReplayOnPicker.js";

describe("ReplayOnPicker (step 14.7, board 1 and 4a)", () => {
  it("lists every vendor's models in groups after an Off choice, marking the session's own model", () => {
    render(<ReplayOnPicker profiles={REPLAY_PROFILES} value={null} sessionModel="claude-opus-5-5" onChange={vi.fn()} />);
    const select = screen.getByLabelText("Replay on");
    expect(select).toHaveValue("");
    const options = within(select).getAllByRole("option");
    expect(options[0]).toHaveTextContent("Off (measured only)");
    expect(within(select).getByRole("group", { name: "Anthropic" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "claude-opus-5.5 (this session)" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "claude-sonnet-5.5" })).toBeEnabled();
  });

  it("keeps a model with undocumented caching listed but disabled, with its reason", () => {
    render(<ReplayOnPicker profiles={REPLAY_PROFILES} value={null} sessionModel="x" onChange={vi.fn()} />);
    const kimi = screen.getByRole("option", { name: "kimi-k3 (not simulated)" });
    expect(kimi).toBeDisabled();
    expect(screen.getByText("Caching undocumented, so it can't be simulated")).toHaveClass("sr-only");
  });

  it("calls back with the model, and null for Off, by keyboard", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<ReplayOnPicker profiles={REPLAY_PROFILES} value={null} sessionModel="x" onChange={onChange} />);
    const select = screen.getByLabelText("Replay on");
    await userEvent.tab();
    expect(select).toHaveFocus();
    await userEvent.selectOptions(select, "gpt-6.1-sol");
    expect(onChange).toHaveBeenLastCalledWith("gpt-6.1-sol");

    rerender(<ReplayOnPicker profiles={REPLAY_PROFILES} value="gpt-6.1-sol" sessionModel="x" onChange={onChange} />);
    await userEvent.selectOptions(select, "");
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("is disabled, saying why, when the session can't be replayed", () => {
    render(<ReplayOnPicker profiles={REPLAY_PROFILES} value={null} sessionModel="x" onChange={vi.fn()} unavailableReason="This provider's logs can't be replayed yet." />);
    const select = screen.getByLabelText("Replay on");
    expect(select).toBeDisabled();
    expect(select).toHaveAccessibleDescription("This provider's logs can't be replayed yet.");
    expect(screen.getByText("This provider's logs can't be replayed yet.")).toBeVisible();
  });
});
