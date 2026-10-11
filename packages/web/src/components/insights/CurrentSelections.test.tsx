import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CurrentSelections } from "./CurrentSelections.js";

function renderBar(selections = { model: ["claude", "gpt-5"], severity: ["critical"] }, canGoBack = true) {
  const handlers = { onClearField: vi.fn(), onClearAll: vi.fn(), onBack: vi.fn() };
  render(
    <CurrentSelections
      selections={selections}
      fieldLabel={(fieldId) => ({ model: "Model", severity: "Severity" })[fieldId] ?? fieldId}
      valueLabel={(_fieldId, value) => value.toUpperCase()}
      canGoBack={canGoBack}
      {...handlers}
    />,
  );
  return handlers;
}

describe("CurrentSelections", () => {
  it("lists every active selection with readable labels", () => {
    renderBar();
    expect(screen.getByRole("listitem", { name: "Model: CLAUDE, GPT-5" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Severity: CRITICAL" })).toBeInTheDocument();
  });

  it("clears one field, all fields, or steps back", () => {
    const { onClearField, onClearAll, onBack } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Clear Severity" }));
    expect(onClearField).toHaveBeenCalledWith("severity");
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClearAll).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("explains how to start when nothing is selected", () => {
    renderBar({} as never, false);
    expect(screen.getByText(/Click any value or bar/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear all" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  });
});
