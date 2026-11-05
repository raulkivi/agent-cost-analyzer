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
