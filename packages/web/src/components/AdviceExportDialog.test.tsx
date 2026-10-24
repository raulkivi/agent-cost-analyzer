import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@copilot-cost-analyzer/domain";
import { buildAdviceBundle } from "../lib/build-advice-bundle.js";
import { makeTurn } from "../test-support/turn-fixture.js";
import { AdviceExportDialog } from "./AdviceExportDialog.js";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    mode: "analyze",
    title: "Refactor auth module",
    model: "gpt-4o",
    turns: [makeTurn({ index: 0 })],
    turnCount: 1,
    costAiCredits: { known: true, value: 1.5 },
    usageDataAvailable: true,
    ...overrides,
  };
}

describe("AdviceExportDialog", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    // defineProperty, not assignment: user-event's setup() installs its own
    // getter-only clipboard stub, which a plain assignment can't replace.
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <AdviceExportDialog sessions={[makeSession()]} open={false} onClose={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows the selected session count, pluralized, when open", () => {
    const { rerender } = render(
      <AdviceExportDialog sessions={[makeSession({ id: "s1" })]} open onClose={vi.fn()} />,
    );
    expect(screen.getByText("1 session selected for advice")).toBeInTheDocument();

    rerender(
      <AdviceExportDialog
        sessions={[makeSession({ id: "s1" }), makeSession({ id: "s2" })]}
        open
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("2 sessions selected for advice")).toBeInTheDocument();
  });

  it("reveals the generated bundle in a preview when Preview is clicked", () => {
    render(
      <AdviceExportDialog sessions={[makeSession({ title: "Refactor auth module" })]} open onClose={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByTestId("advice-preview")).toHaveTextContent("Refactor auth module");
  });

  it("excludes tool argsSummary from the preview by default, and includes it once 'Include tool call args' is checked", () => {
    const sessions = [
      makeSession({
        turns: [makeTurn({ index: 0, toolCalls: [{ name: "search_text", argsSummary: "SECRET_SNIPPET" }] })],
      }),
    ];
    render(<AdviceExportDialog sessions={sessions} open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByTestId("advice-preview")).not.toHaveTextContent("SECRET_SNIPPET");

    fireEvent.click(screen.getByRole("checkbox", { name: /include tool call args/i }));

    expect(screen.getByTestId("advice-preview")).toHaveTextContent("SECRET_SNIPPET");
  });

  it("warns when a selected session hasn't been opened yet, so its turn-level detail is missing", () => {
    const notYetOpened = makeSession({ id: "s1", title: "Not opened", turnCount: 5, turns: [] });
    render(<AdviceExportDialog sessions={[notYetOpened]} open onClose={vi.fn()} />);

    expect(screen.getByText(/1 selected session hasn't been opened yet/i)).toBeInTheDocument();
  });

  it("does not warn when every selected session's turns are already loaded", () => {
    render(
      <AdviceExportDialog sessions={[makeSession({ turnCount: 1, turns: [makeTurn()] })]} open onClose={vi.fn()} />,
    );

    expect(screen.queryByText(/hasn't been opened yet/i)).not.toBeInTheDocument();
  });

  it("copies the generated bundle to the clipboard and shows a confirmation", async () => {
    const sessions = [makeSession()];
    render(<AdviceExportDialog sessions={sessions} open onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy advice prompt" }));

    expect(writeText).toHaveBeenCalledWith(buildAdviceBundle(sessions, { includeToolArgs: false }));
    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  it("calls onClose when the Close button is clicked", () => {
    const onClose = vi.fn();
    render(<AdviceExportDialog sessions={[makeSession()]} open onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when the backdrop is clicked, but not when the dialog body is clicked", () => {
    const onClose = vi.fn();
    render(<AdviceExportDialog sessions={[makeSession()]} open onClose={onClose} />);

    fireEvent.click(screen.getByText("Export advice bundle"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("advice-dialog-backdrop"));
    expect(onClose).toHaveBeenCalled();
  });

  describe("host capabilities and product profile (vscode-extension.md G8, G10)", () => {
    it("copies through the copyToClipboard it is given (the extension host's clipboard), not the browser's", async () => {
      const sessions = [makeSession()];
      const copyToClipboard = vi.fn().mockResolvedValue(undefined);
      render(<AdviceExportDialog sessions={sessions} open onClose={vi.fn()} copyToClipboard={copyToClipboard} />);

      fireEvent.click(screen.getByRole("button", { name: "Copy advice prompt" }));

      expect(copyToClipboard).toHaveBeenCalledWith(buildAdviceBundle(sessions, { includeToolArgs: false }));
      expect(writeText).not.toHaveBeenCalled();
      expect(await screen.findByRole("button", { name: "Copied!" })).toBeInTheDocument();
    });

    it("doesn't claim a copy the host refused", async () => {
      const copyToClipboard = vi.fn().mockRejectedValue(new Error("Request to copyToClipboard failed with status 400"));
      render(<AdviceExportDialog sessions={[makeSession()]} open onClose={vi.fn()} copyToClipboard={copyToClipboard} />);

      fireEvent.click(screen.getByRole("button", { name: "Copy advice prompt" }));

      await vi.waitFor(() => expect(copyToClipboard).toHaveBeenCalled());
      expect(screen.queryByText("Copied!")).not.toBeInTheDocument();
    });

    it.each(["Agent Cost Analyzer", "AI Credits Analyzer"])("names %s in the bundle it previews and copies", async (productName) => {
      const sessions = [makeSession()];
      render(<AdviceExportDialog sessions={sessions} open onClose={vi.fn()} productName={productName} />);

      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
      expect(screen.getByTestId("advice-preview")).toHaveTextContent(`Exported from ${productName}.`);

      fireEvent.click(screen.getByRole("button", { name: "Copy advice prompt" }));
      expect(writeText).toHaveBeenCalledWith(buildAdviceBundle(sessions, { includeToolArgs: false, productName }));
      expect(await screen.findByText("Copied!")).toBeInTheDocument();
    });
  });

  // §3.5 Accessibility: a modal dialog, by keyboard.
  describe("keyboard and focus", () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Export advice
          </button>
          <AdviceExportDialog sessions={[makeSession()]} open={open} onClose={() => setOpen(false)} />
        </>
      );
    }

    it("is a labelled modal dialog", () => {
      render(<AdviceExportDialog sessions={[makeSession()]} open onClose={vi.fn()} />);

      const dialog = screen.getByRole("dialog", { name: "Export advice bundle" });
      expect(dialog).toHaveAttribute("aria-modal", "true");
    });

    it("traps Tab inside while open, then gives focus back to its opener", async () => {
      const user = userEvent.setup();
      render(<Host />);
      await user.click(screen.getByRole("button", { name: "Export advice" }));

      const dialog = screen.getByRole("dialog");
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
      for (let step = 0; step < 6; step++) {
        await user.tab();
        expect(dialog).toContainElement(document.activeElement as HTMLElement);
      }

      await user.click(screen.getByRole("button", { name: "Close" }));
      expect(screen.getByRole("button", { name: "Export advice" })).toHaveFocus();
    });

    it("closes on Escape", async () => {
      const user = userEvent.setup();
      render(<Host />);
      await user.click(screen.getByRole("button", { name: "Export advice" }));

      await user.keyboard("{Escape}");

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Export advice" })).toHaveFocus();
    });
  });
});
