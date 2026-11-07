// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./SegmentedControl.js";

const options = [
  { value: "learn", label: "Learn" },
  { value: "analyze", label: "Analyze" },
] as const;

describe("SegmentedControl", () => {
  it("renders one option per entry, with the current value checked", () => {
    render(
      <SegmentedControl name="mode" options={options} value="learn" onChange={vi.fn()} />,
    );

    expect(screen.getByLabelText("Learn")).toBeChecked();
    expect(screen.getByLabelText("Analyze")).not.toBeChecked();
  });

  it("calls onChange with the clicked option's value", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl name="mode" options={options} value="learn" onChange={onChange} />,
    );

    fireEvent.click(screen.getByLabelText("Analyze"));

    expect(onChange).toHaveBeenCalledWith("analyze");
  });

  it("groups all options under the same radio input name", () => {
    render(
      <SegmentedControl name="mode" options={options} value="learn" onChange={vi.fn()} />,
    );

    expect(screen.getByLabelText("Learn")).toHaveAttribute("name", "mode");
    expect(screen.getByLabelText("Analyze")).toHaveAttribute("name", "mode");
  });
});
