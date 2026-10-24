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
});
