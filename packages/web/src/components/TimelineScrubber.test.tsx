import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimelineScrubber } from "./TimelineScrubber.js";

describe("TimelineScrubber", () => {
  it("renders a slider spanning every turn", () => {
    render(<TimelineScrubber turnCount={5} selectedTurnIndex={2} onSelectTurn={() => {}} />);

    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("min", "0");
    expect(slider).toHaveAttribute("max", "4");
    expect(slider).toHaveValue("2");
  });

  it("calls onSelectTurn with the new index when moved", () => {
    const onSelectTurn = vi.fn();
    render(<TimelineScrubber turnCount={5} selectedTurnIndex={0} onSelectTurn={onSelectTurn} />);

    fireEvent.change(screen.getByRole("slider"), { target: { value: "3" } });

    expect(onSelectTurn).toHaveBeenCalledWith(3);
  });

  it("renders the Timeline label and a 1-indexed 'Turn N of M' readout", () => {
    render(<TimelineScrubber turnCount={5} selectedTurnIndex={2} onSelectTurn={() => {}} />);

    expect(screen.getByText("Timeline")).toBeInTheDocument();
    expect(screen.getByText("Turn 3 of 5")).toBeInTheDocument();
  });

  // axe (§3.5): a form control needs a name; the value reads as a turn.
  it("names the slider after its label and says which turn it's on", () => {
    render(<TimelineScrubber turnCount={5} selectedTurnIndex={2} onSelectTurn={() => {}} />);

    const slider = screen.getByRole("slider", { name: "Timeline" });
    expect(slider).toHaveAttribute("aria-valuetext", "Turn 3 of 5");
  });

  // The VS Code theme styles it by this class (step 10.11).
  it("marks its range input for the theme's track and thumb", () => {
    render(<TimelineScrubber turnCount={3} selectedTurnIndex={0} onSelectTurn={vi.fn()} />);

    expect(screen.getByRole("slider")).toHaveClass("timeline-range");
  });
});
