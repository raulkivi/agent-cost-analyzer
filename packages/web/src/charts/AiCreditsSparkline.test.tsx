import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeTurn } from "../test-support/turn-fixture.js";
import { AiCreditsSparkline } from "./AiCreditsSparkline.js";

describe("AiCreditsSparkline", () => {
  it("renders a path connecting every turn with a known AI Credits value", () => {
    const turns = [
      makeTurn({ index: 0, usage: { ...makeTurn().usage, costAiCredits: { known: true, value: 0.01 } } }),
      makeTurn({ index: 1, usage: { ...makeTurn().usage, costAiCredits: { known: true, value: 0.05 } } }),
      makeTurn({ index: 2, usage: { ...makeTurn().usage, costAiCredits: { known: true, value: 0.02 } } }),
    ];

    render(<AiCreditsSparkline turns={turns} />);

    const path = screen.getByTestId("ai-credits-sparkline-path");
    expect(path.getAttribute("d")).toBeTruthy();
    expect(screen.getByRole("img", { name: "AI Credits sparkline" })).toBeInTheDocument();
  });

  it("shows a fallback instead of a path when fewer than two turns have a known AI Credits value", () => {
    const turns = [
      makeTurn({ index: 0, usage: { ...makeTurn().usage, costAiCredits: { known: true, value: 0.01 } } }),
      makeTurn({ index: 1, usage: { ...makeTurn().usage, costAiCredits: { known: false, reason: "no data" } } }),
    ];

    render(<AiCreditsSparkline turns={turns} />);

    expect(screen.getByTestId("ai-credits-sparkline-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("ai-credits-sparkline-path")).not.toBeInTheDocument();
  });

  it("offers every turn's AI Credits as a table, rounded to 2 places, unknown as unknown", () => {
    const turns = [
      makeTurn({ index: 0, usage: { ...makeTurn().usage, costAiCredits: { known: true, value: 0.0149 } } }),
      makeTurn({ index: 1, usage: { ...makeTurn().usage, costAiCredits: { known: false, reason: "no data" } } }),
      makeTurn({ index: 2, usage: { ...makeTurn().usage, costAiCredits: { known: true, value: 1 } } }),
    ];
    render(<AiCreditsSparkline turns={turns} />);
    const toggle = screen.getByRole("button", { name: "View as table" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    const table = screen.getByRole("table", { name: "AI Credits per turn" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Turn", "AI Credits"]);
    const cells = within(table).getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toEqual(["0.01", "unknown", "1.00"]);
  });

  it("keeps the sparkline's own label while the chart shows", () => {
    render(<AiCreditsSparkline turns={[makeTurn({ index: 0 }), makeTurn({ index: 1 })]} />);
    expect(screen.getByRole("img", { name: "AI Credits sparkline" })).toBeInTheDocument();
  });
});
