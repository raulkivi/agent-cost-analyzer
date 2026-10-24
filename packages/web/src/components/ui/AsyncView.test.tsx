import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AsyncView, cancelledEmptyState, SKELETON_DELAY_MS } from "./AsyncView.js";

// §3.5 States, mock-up board 5 (States.dc.html).
describe("AsyncView", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const skeleton = () => screen.queryByTestId("async-skeleton");

  describe("loading", () => {
    it("shows no skeleton for the first 300 ms, so a quick load doesn't flash", () => {
      render(<AsyncView status="loading" loadingText="Loading sessions…" />);

      expect(SKELETON_DELAY_MS).toBe(300);
      act(() => vi.advanceTimersByTime(299));
      expect(skeleton()).not.toBeInTheDocument();
    });

    it("shows the skeleton, with a progress bar, after 300 ms", () => {
      render(<AsyncView status="loading" loadingText="Loading sessions…" />);

      act(() => vi.advanceTimersByTime(300));

      expect(skeleton()).toBeInTheDocument();
      expect(screen.getByRole("progressbar", { name: "Loading sessions…" })).toBeInTheDocument();
    });

    it("announces the load at once, politely, for screen readers", () => {
      render(<AsyncView status="loading" loadingText="Loading sessions…" />);

      const status = screen.getByRole("status");
      expect(status).toHaveAttribute("aria-live", "polite");
      expect(status).toHaveTextContent("Loading sessions…");
    });

    it("offers Cancel only where the load can be cancelled", () => {
      const onCancel = vi.fn();
      const { rerender } = render(<AsyncView status="loading" loadingText="Loading…" />);
      act(() => vi.advanceTimersByTime(300));
      expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();

      rerender(<AsyncView status="loading" loadingText="Loading…" onCancel={onCancel} />);
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("waits 300 ms again when a later load starts", () => {
      const { rerender } = render(<AsyncView status="loading" loadingText="Loading…" />);
      act(() => vi.advanceTimersByTime(300));
      rerender(<AsyncView status="ready" loadingText="Loading…">done</AsyncView>);

      rerender(<AsyncView status="loading" loadingText="Loading…" />);

      expect(skeleton()).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(300));
      expect(skeleton()).toBeInTheDocument();
    });
  });

  it("renders its content when ready, and announces it", () => {
    render(
      <AsyncView status="ready" loadingText="Loading sessions…" readyText="3 sessions loaded.">
        <p>the list</p>
      </AsyncView>,
    );

    expect(screen.getByText("the list")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("3 sessions loaded.");
    expect(skeleton()).not.toBeInTheDocument();
  });

  it("explains an empty result and offers the next step", () => {
    const onClick = vi.fn();
    render(
      <AsyncView
        status="empty"
        loadingText="Loading…"
        empty={{
          title: "No tool calls in this session",
          body: "The agent answered without running tools, so there is nothing to audit here.",
          action: { label: "View all sessions", onClick },
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "No tool calls in this session" })).toBeInTheDocument();
    expect(screen.getByText(/nothing to audit here/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View all sessions" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  describe("error", () => {
    function renderError(copyToClipboard = vi.fn().mockResolvedValue(undefined), onRetry = vi.fn()) {
      render(
        <AsyncView
          status="error"
          loadingText="Loading…"
          error={{ title: "Couldn't read session-store.db", details: "SQLITE_BUSY: database is locked", onRetry }}
          copyToClipboard={copyToClipboard}
        />,
      );
      return { copyToClipboard, onRetry };
    }

    it("says what failed and that nothing was changed, as an alert", () => {
      renderError();

      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("Couldn't read session-store.db");
      expect(alert).toHaveTextContent("SQLITE_BUSY: database is locked");
      expect(alert).toHaveTextContent(/nothing was changed/i);
    });

    it("retries", () => {
      const { onRetry } = renderError();

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));

      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("copies the details", async () => {
      const { copyToClipboard } = renderError();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
      });

      expect(copyToClipboard).toHaveBeenCalledWith("Couldn't read session-store.db\nSQLITE_BUSY: database is locked");
      expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    });
  });

  it("shows partial data with a warning (icon and text), never as a zero", () => {
    render(
      <AsyncView
        status="ready"
        loadingText="Loading…"
        partial="AI Credits are unknown for 1 of 4 sessions today. Totals include only sessions with cost data."
      >
        <p>totals</p>
      </AsyncView>,
    );

    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Partial data");
    expect(note).toHaveTextContent(/unknown for 1 of 4 sessions/);
    expect(screen.getByText("totals")).toBeInTheDocument();
  });

  it("shows a cancelled load as an empty state with Retry, not an error alert", () => {
    const onRetry = vi.fn();
    render(<AsyncView status="empty" loadingText="Loading…" empty={cancelledEmptyState(onRetry)} />);

    expect(screen.getByRole("heading", { name: "Loading cancelled" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
