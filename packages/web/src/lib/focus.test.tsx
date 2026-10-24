import { useRef, useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useEscapeKey, useFocusReturn, useFocusTrap } from "./focus.js";

describe("useEscapeKey", () => {
  function Probe({ onEscape, enabled }: { onEscape: () => void; enabled?: boolean }) {
    useEscapeKey(onEscape, enabled);
    return <input aria-label="field" />;
  }

  it("calls back on Escape anywhere in the page", async () => {
    const user = userEvent.setup();
    const onEscape = vi.fn();
    render(<Probe onEscape={onEscape} />);

    await user.click(screen.getByLabelText("field"));
    await user.keyboard("{Escape}");

    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("does nothing while disabled, or for other keys", async () => {
    const user = userEvent.setup();
    const onEscape = vi.fn();
    const { rerender } = render(<Probe onEscape={onEscape} enabled={false} />);

    await user.keyboard("{Escape}");
    rerender(<Probe onEscape={onEscape} />);
    await user.keyboard("{Enter}");

    expect(onEscape).not.toHaveBeenCalled();
  });

  it("leaves an Escape that an inner control already handled (a popover closing) alone", async () => {
    const user = userEvent.setup();
    const onEscape = vi.fn();
    render(
      <div onKeyDown={(event) => event.key === "Escape" && event.stopPropagation()}>
        <Probe onEscape={onEscape} />
      </div>,
    );

    await user.click(screen.getByLabelText("field"));
    await user.keyboard("{Escape}");

    expect(onEscape).not.toHaveBeenCalled();
  });
});

describe("useFocusReturn", () => {
  function View({ onClose }: { onClose: () => void }) {
    const first = useRef<HTMLButtonElement>(null);
    useFocusReturn(first);
    return (
      <button ref={first} type="button" onClick={onClose}>
        Back
      </button>
    );
  }

  function Host() {
    const [open, setOpen] = useState(false);
    return open ? (
      <View onClose={() => setOpen(false)} />
    ) : (
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
    );
  }

  it("moves focus into the view on open", async () => {
    const user = userEvent.setup();
    render(<Host />);

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(screen.getByRole("button", { name: "Back" })).toHaveFocus();
  });

  it("gives focus back to the opener when it's still there on close", async () => {
    const user = userEvent.setup();
    function Persistent() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          {open && <View onClose={() => setOpen(false)} />}
        </>
      );
    }
    render(<Persistent />);

    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();
  });
});

describe("useFocusTrap", () => {
  function Dialog({ onClose }: { onClose: () => void }) {
    const container = useRef<HTMLDivElement>(null);
    useFocusTrap(container);
    return (
      <div ref={container} role="dialog" aria-label="Dialog">
        <button type="button">First</button>
        <button type="button" disabled>
          Disabled
        </button>
        <button type="button" onClick={onClose}>
          Last
        </button>
      </div>
    );
  }

  function Host() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open dialog
        </button>
        <button type="button">Outside</button>
        {open && <Dialog onClose={() => setOpen(false)} />}
      </>
    );
  }

  it("focuses the first control on open and keeps Tab and Shift+Tab inside", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole("button", { name: "Open dialog" }));

    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
  });

  it("restores focus to the opener on close", async () => {
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole("button", { name: "Open dialog" }));

    await user.click(screen.getByRole("button", { name: "Last" }));

    expect(screen.getByRole("button", { name: "Open dialog" })).toHaveFocus();
  });
});
