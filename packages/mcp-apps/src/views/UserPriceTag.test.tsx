// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UserPriceTag } from "./UserPriceTag.js";

describe("UserPriceTag", () => {
  it("renders nothing without ids", () => {
    expect(render(<UserPriceTag />).container).toBeEmptyDOMElement();
    expect(render(<UserPriceTag ids={[]} />).container).toBeEmptyDOMElement();
  });

  it("is a note reading 'your prices' whose accessible name names the versions", () => {
    render(<UserPriceTag ids={["mine-1", "mine-2"]} />);
    const note = screen.getByRole("note", { name: "Priced with your own price versions: mine-1, mine-2" });
    expect(note).toHaveTextContent("your prices");
    expect(note.getAttribute("title")).toContain("mine-1, mine-2");
  });

  it("renders a hostile id as inert, folded text", () => {
    const hostile = "<img src=x onerror=alert(1)>\u202Eevil\u2028id";
    const { container } = render(<UserPriceTag ids={[hostile]} />);
    expect(container.querySelector("img")).toBeNull();
    const name = screen.getByRole("note").getAttribute("aria-label") ?? "";
    expect(name).toContain("<img src=x onerror=alert(1)>");
    expect(name).not.toMatch(/[\u202E\u2028]/u);
  });
});
