import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ALL_TURN_COLUMNS, type TurnColumnId } from "../lib/turn-columns.js";
import { ColumnChooser } from "./ColumnChooser.js";

function Stateful({ initial = ALL_TURN_COLUMNS, onChange }: { initial?: TurnColumnId[]; onChange?: (ids: TurnColumnId[]) => void }) {
  const [visible, setVisible] = useState<TurnColumnId[]>(initial);
  return (
    <ColumnChooser
      visible={visible}
      onChange={(ids) => {
        setVisible(ids);
        onChange?.(ids);
      }}
    />
  );
}

describe("ColumnChooser (§3.5 Layout, mock-up board 1)", () => {
  it("says how many columns show, with a collapsed Columns button", () => {
    render(<Stateful initial={["turn", "trigger", "aiCredits"]} />);

    expect(screen.getByText("Showing 3 of 14 columns")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Columns" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("opens a labelled checkbox per column, checked when visible; Turn can't be hidden", async () => {
    const user = userEvent.setup();
    render(<Stateful initial={["turn", "model"]} />);

    await user.click(screen.getByRole("button", { name: "Columns" }));

    const group = screen.getByRole("group", { name: "Visible columns" });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(14);
    expect(screen.getByRole("checkbox", { name: "Model" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Rounds" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Turn" })).toBeDisabled();
  });

  it("shows and hides columns, reporting the choice in display order", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Stateful initial={["turn", "model"]} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Columns" }));

    await user.click(screen.getByRole("checkbox", { name: "AI Credits" }));
    expect(onChange).toHaveBeenLastCalledWith(["turn", "aiCredits", "model"]);

    await user.click(screen.getByRole("checkbox", { name: "Model" }));
    expect(onChange).toHaveBeenLastCalledWith(["turn", "aiCredits"]);
    expect(screen.getByText("Showing 2 of 14 columns")).toBeInTheDocument();
  });

  it("works by keyboard: Enter opens, Space toggles, Escape closes and returns focus", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Stateful initial={["turn"]} onChange={onChange} />);

    screen.getByRole("button", { name: "Columns" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Columns" })).toHaveAttribute("aria-expanded", "true");

    await user.tab(); // Turn is disabled, so focus lands on Trigger
    expect(screen.getByRole("checkbox", { name: "Trigger" })).toHaveFocus();
    await user.keyboard(" ");
    expect(onChange).toHaveBeenLastCalledWith(["turn", "trigger"]);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Visible columns" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Columns" })).toHaveFocus();
  });
});
