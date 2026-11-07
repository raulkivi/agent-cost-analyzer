// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeTurn } from "../test-support/turn-fixture.js";
import { SessionKpiTiles } from "./SessionKpiTiles.js";

describe("SessionKpiTiles (narrow layout, mock-up board 4)", () => {
  it("shows AI Credits, cache read, turns and tool calls as four labelled tiles in a 2×2 grid", () => {
    const { container } = render(<SessionKpiTiles turns={[makeTurn({ index: 1 }), makeTurn({ index: 2 })]} />);

    expect(container.firstElementChild).toHaveClass("kpi-grid");
    expect(screen.getByRole("group", { name: "AI Credits" })).toHaveTextContent("0.02");
    expect(screen.getByRole("group", { name: "Cache read" })).toHaveTextContent("50%");
    expect(screen.getByRole("group", { name: "Turns" })).toHaveTextContent("2");
    expect(screen.getByRole("group", { name: "Tool calls" })).toHaveTextContent("0");
  });

  it("adds a USD tooltip to the AI Credits tile of a simulated session only", () => {
    const simulation = {
      vendorId: "anthropic",
      modelId: "claude-sonnet-5.5",
      cacheOutcome: "hit" as const,
      note: "n",
      confidence: "inferred" as const,
      sourceIds: [],
    };
    const credits = (value: number) => ({
      usage: { ...makeTurn().usage, costAiCredits: { known: true as const, value } },
    });
    const { rerender } = render(
      <SessionKpiTiles turns={[makeTurn({ ...credits(100), simulation }), makeTurn({ ...credits(50), simulation })]} />,
    );
    expect(screen.getByRole("group", { name: "AI Credits" })).toHaveAttribute("title", "≈ $1.50");

    rerender(<SessionKpiTiles turns={[makeTurn(credits(100))]} />);
    expect(screen.getByRole("group", { name: "AI Credits" })).not.toHaveAttribute("title");
  });
});
