// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CacheOutcomeBadge } from "./CacheOutcomeBadge.js";

describe("CacheOutcomeBadge", () => {
  it.each([
    ["hit", "●", "Cache hit"],
    ["partial", "◐", "Cache partial hit"],
    ["miss", "○", "Cache miss"],
    ["unknown", "?", "Cache outcome unknown"],
  ] as const)("shows a glyph and text for %s", (outcome, glyph, text) => {
    const { container } = render(<CacheOutcomeBadge outcome={outcome} />);
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe(
      glyph,
    );
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("hides the text visually but keeps it for screen readers", () => {
    render(<CacheOutcomeBadge outcome="hit" />);
    expect(screen.getByText("Cache hit")).toHaveClass("sr-only");
  });
});

// Step 14.7: the replay's Cache column shows the outcome as a word and icon.
describe("CacheOutcomeBadge with its word shown", () => {
  it.each([
    ["hit", "Hit"],
    ["partial", "Partial"],
    ["miss", "Miss"],
    ["unknown", "Unknown"],
  ] as const)("shows %s as %s, readable once", (outcome, word) => {
    const { container } = render(<CacheOutcomeBadge outcome={outcome} showWord />);
    expect(container).toHaveTextContent(word);
    expect(container.querySelector(".sr-only")).toBeNull();
  });
});
