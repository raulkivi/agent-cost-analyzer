// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GENERIC_BRAND, type ViewBrand } from "../brand/view-brand.js";
import { ViewShell } from "./ViewShell.js";

const brand: ViewBrand = { productId: "vscode-extension", displayName: "AI Credits Analyzer", version: "0.4.0" };

describe("ViewShell", () => {
  it("keeps the original props working: brand, kicker, title, children", () => {
    render(
      <ViewShell brand={brand} kicker="Findings" title="Findings">
        <p>body</p>
      </ViewShell>,
    );
    expect(screen.getByRole("main", { name: "Findings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Findings" })).toBeInTheDocument();
    expect(screen.getByText("AI Credits Analyzer · Findings")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("draws the product mark (hidden from assistive tech) and the four corner marks", () => {
    const { container } = render(<ViewShell brand={brand} kicker="k" title="t" />);
    expect(container.querySelector("svg.brand-mark")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelectorAll(".blueprint > .corner")).toHaveLength(4);
  });

  it("shows the read-only footer with the version", () => {
    render(<ViewShell brand={brand} kicker="k" title="t" />);
    expect(screen.getByText("Read-only · local logs · v0.4.0")).toBeInTheDocument();
  });

  it("leaves the version out of the footer when the brand has none", () => {
    render(<ViewShell brand={GENERIC_BRAND} kicker="k" title="t" />);
    expect(screen.getByText("Read-only · local logs")).toBeInTheDocument();
  });

  it("takes optional header meta and footer actions", () => {
    render(<ViewShell brand={brand} kicker="k" title="t" meta="42 turns" actions={<button>Do it</button>} />);
    expect(screen.getByText("42 turns")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Do it" })).toBeInTheDocument();
  });
});
