import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Drawer } from "./Drawer.js";

function Host({ placement = "side" as const }: { placement?: "side" | "inline" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Details
      </button>
      <button type="button">Elsewhere</button>
      {open && (
        <Drawer title="Turn 7 details" placement={placement} onClose={() => setOpen(false)}>
          <button type="button">Inside</button>
        </Drawer>
      )}
    </>
  );
}

// §3.5 Layout: the medium layout's right column and the narrow layout's
// turn details, as a non-modal drawer.
describe("Drawer", () => {
  it("is a region named by its heading, with a Close button", () => {
    render(
      <Drawer title="Turn 7 details" onClose={vi.fn()}>
        content
      </Drawer>,
    );

    const region = screen.getByRole("region", { name: "Turn 7 details" });
    expect(region).toHaveTextContent("content");
    expect(screen.getByRole("heading", { name: "Turn 7 details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close details" })).toBeInTheDocument();
  });

  it("takes focus when it opens and gives it back on close", async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByRole("button", { name: "Close details" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Close details" }));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Details" })).toHaveFocus();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole("button", { name: "Details" }));

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });

  it("doesn't trap focus: Tab leaves it", async () => {
    const user = userEvent.setup();
    render(<Host placement="inline" />);
    await user.click(screen.getByRole("button", { name: "Details" }));

    await user.tab();
    expect(screen.getByRole("button", { name: "Inside" })).toHaveFocus();
    await user.tab();
    expect(document.body).toHaveFocus();
  });

  it("is placed beside the content or inline below it", () => {
    const { rerender } = render(
      <Drawer title="t" placement="side" onClose={vi.fn()}>
        x
      </Drawer>,
    );
    expect(screen.getByRole("region")).toHaveClass("drawer", "drawer--side");

    rerender(
      <Drawer title="t" placement="inline" onClose={vi.fn()}>
        x
      </Drawer>,
    );
    expect(screen.getByRole("region")).toHaveClass("drawer", "drawer--inline");
  });
});
