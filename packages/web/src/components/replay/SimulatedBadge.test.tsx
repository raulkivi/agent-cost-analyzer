// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SimulatedBadge } from "./SimulatedBadge.js";

describe("SimulatedBadge (step 14.7)", () => {
  it("says Simulated in words, with a decorative icon, so it never relies on the dashed style", () => {
    const { container } = render(<SimulatedBadge />);
    expect(screen.getByText("Simulated")).toHaveClass("sim-badge");
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
