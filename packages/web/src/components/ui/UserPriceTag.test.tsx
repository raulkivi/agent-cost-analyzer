// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UserPriceTag } from "./UserPriceTag.js";

// 1.0 V2 (threat-model 5.10): a figure priced from the user's own price
// versions says so; every other figure shows nothing.
describe("UserPriceTag", () => {
  it("says 'your prices' with an accessible name and a title naming the versions", () => {
    render(<UserPriceTag ids={["mine-2026-10-01", "mine-2026-11-01"]} />);
    const tag = screen.getByRole("note", { name: "Priced with your own price versions: mine-2026-10-01, mine-2026-11-01" });
    expect(tag).toHaveTextContent("your prices");
    expect(tag).toHaveAttribute("title", expect.stringContaining("mine-2026-10-01, mine-2026-11-01"));
  });

  it("names one version in the singular", () => {
    render(<UserPriceTag ids={["mine"]} />);
    expect(screen.getByRole("note", { name: "Priced with your own price version: mine" })).toBeInTheDocument();
  });

  it.each([undefined, []])("shows nothing for %j (bundled, billed, reported or unknown)", (ids) => {
    const { container } = render(<UserPriceTag ids={ids} />);
    expect(container).toBeEmptyDOMElement();
  });
});
