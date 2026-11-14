// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ColorModeSwitch } from "./ColorModeSwitch.js";

describe("ColorModeSwitch", () => {
  it("is a named radiogroup with Auto, Light and Dark, the preference selected", () => {
    render(<ColorModeSwitch preference="light" onChange={vi.fn()} />);
    const group = screen.getByRole("radiogroup", { name: "Colour theme" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Auto" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Dark" })).not.toBeChecked();
  });

  it("reports the chosen preference", () => {
    const onChange = vi.fn();
    render(<ColorModeSwitch preference="auto" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(onChange).toHaveBeenCalledWith("dark");
  });
});
