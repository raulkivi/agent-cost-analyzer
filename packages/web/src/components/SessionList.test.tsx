import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Session } from "@agent-cost-analyzer/domain";
import { SessionList } from "./SessionList.js";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    mode: "learn",
    title: "Cache write then read",
    model: "gpt-4o",
    turns: [{ index: 0 } as Session["turns"][number], { index: 1 } as Session["turns"][number]],
    turnCount: 2,
    costAiCredits: { known: false, reason: "not extracted" },
    usageDataAvailable: false,
    ...overrides,
  };
}

describe("SessionList", () => {
  it("renders 'Scenarios' as the heading in learn mode and 'Sessions' in analyze mode", () => {
    const { rerender } = render(
      <SessionList mode="learn" sessions={[]} selectedSessionId={null} onSelect={vi.fn()} />,
    );
    expect(screen.getByText("Scenarios")).toBeInTheDocument();

    rerender(<SessionList mode="analyze" sessions={[]} selectedSessionId={null} onSelect={vi.fn()} />);
    expect(screen.getByText("Sessions")).toBeInTheDocument();
  });

  it("renders a card per session with title and turn count", () => {
    const sessions = [makeSession({ id: "s1", title: "First" }), makeSession({ id: "s2", title: "Second" })];
    render(<SessionList mode="learn" sessions={sessions} selectedSessionId={null} onSelect={vi.fn()} />);

    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.getAllByText("2 turns")).toHaveLength(2);
  });

  it("renders the card's turn count from turnCount, not turns.length (Analyze-mode summaries omit turn detail)", () => {
    const sessions = [makeSession({ id: "s1", title: "Real session", turns: [], turnCount: 7 })];
    render(<SessionList mode="analyze" sessions={sessions} selectedSessionId={null} onSelect={vi.fn()} />);

    expect(screen.getByText("7 turns")).toBeInTheDocument();
  });

  it("renders a session's AI Credits total, rounded to 2 decimal places, when known", () => {
    const sessions = [
      makeSession({ id: "s1", title: "First", costAiCredits: { known: true, value: 12.3456 } }),
    ];
    render(<SessionList mode="analyze" sessions={sessions} selectedSessionId={null} onSelect={vi.fn()} />);

    expect(screen.getByText("2 turns · 12.35 AI Credits")).toBeInTheDocument();
  });

  it("omits AI Credits from the card meta line when the session's cost is unknown", () => {
    const sessions = [
      makeSession({ id: "s1", title: "First", costAiCredits: { known: false, reason: "not extracted" } }),
    ];
    render(<SessionList mode="analyze" sessions={sessions} selectedSessionId={null} onSelect={vi.fn()} />);

    expect(screen.getByText("2 turns")).toBeInTheDocument();
    expect(screen.queryByText(/AI Credits/)).not.toBeInTheDocument();
  });

  // Step 10.11: the mode switch already says Learn or Analyze, so the
  // kicker no longer repeats it on every card.
  it("renders the Learn kicker as the category alone, and none without one", () => {
    const sessions = [
      makeSession({ id: "s1", title: "First", category: "Prompt caching" }),
      makeSession({ id: "s2", title: "Second" }),
    ];
    render(<SessionList mode="learn" sessions={sessions} selectedSessionId={null} onSelect={vi.fn()} />);

    expect(screen.getByText("Prompt caching")).toBeInTheDocument();
    expect(screen.queryByText(/^Learn/)).not.toBeInTheDocument();
    expect(document.querySelectorAll(".card-kicker")).toHaveLength(1);
  });

  it("renders the Analyze kicker as the relative time alone, and none without one", () => {
    const sessions = [
      makeSession({
        id: "s1",
        mode: "analyze",
        title: "First",
        startedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      }),
      makeSession({ id: "s2", mode: "analyze", title: "Second" }),
    ];
    render(<SessionList mode="analyze" sessions={sessions} selectedSessionId={null} onSelect={vi.fn()} />);

    expect(screen.getByText("2 days ago")).toBeInTheDocument();
    expect(screen.queryByText(/^Analyze/)).not.toBeInTheDocument();
    expect(document.querySelectorAll(".card-kicker")).toHaveLength(1);
  });

  it("calls onSelect with the clicked session", () => {
    const onSelect = vi.fn();
    const sessions = [makeSession({ id: "s1", title: "First" })];
    render(<SessionList mode="learn" sessions={sessions} selectedSessionId={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByText("First"));

    expect(onSelect).toHaveBeenCalledWith(sessions[0]);
  });

  it("activates a card via Enter/Space keydown", () => {
    const onSelect = vi.fn();
    const sessions = [makeSession({ id: "s1", title: "First" })];
    render(<SessionList mode="learn" sessions={sessions} selectedSessionId={null} onSelect={onSelect} />);

    fireEvent.keyDown(screen.getByRole("button", { name: /First/ }), { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith(sessions[0]);
  });

  it("filters the list by title via the search input", () => {
    const sessions = [makeSession({ id: "s1", title: "Alpha" }), makeSession({ id: "s2", title: "Beta" })];
    render(<SessionList mode="learn" sessions={sessions} selectedSessionId={null} onSelect={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Search…"), { target: { value: "alp" } });

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
  });

  it("shows 'No matches.' when the search filters out every session", () => {
    const sessions = [makeSession({ id: "s1", title: "Alpha" })];
    render(<SessionList mode="learn" sessions={sessions} selectedSessionId={null} onSelect={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("Search…"), { target: { value: "zzz" } });

    expect(screen.getByText("No matches.")).toBeInTheDocument();
  });

  it("does not render advice-selection checkboxes when onToggleAdvice is omitted", () => {
    const sessions = [makeSession({ id: "s1", title: "First" })];
    render(<SessionList mode="learn" sessions={sessions} selectedSessionId={null} onSelect={vi.fn()} />);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("renders an advice-selection checkbox per session, checked per adviceSelection, when onToggleAdvice is provided", () => {
    const sessions = [makeSession({ id: "s1", title: "First" }), makeSession({ id: "s2", title: "Second" })];
    render(
      <SessionList
        mode="learn"
        sessions={sessions}
        selectedSessionId={null}
        onSelect={vi.fn()}
        adviceSelection={new Set(["s2"])}
        onToggleAdvice={vi.fn()}
      />,
    );

    expect(screen.getByRole("checkbox", { name: /First/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Second/ })).toBeChecked();
  });

  it("calls onToggleAdvice (not onSelect) when a session's advice checkbox is clicked", () => {
    const onSelect = vi.fn();
    const onToggleAdvice = vi.fn();
    const sessions = [makeSession({ id: "s1", title: "First" })];
    render(
      <SessionList
        mode="learn"
        sessions={sessions}
        selectedSessionId={null}
        onSelect={onSelect}
        adviceSelection={new Set()}
        onToggleAdvice={onToggleAdvice}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /First/ }));

    expect(onToggleAdvice).toHaveBeenCalledWith(sessions[0]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  // §3.5 Accessibility: arrow keys move through the list, Enter opens.
  describe("keyboard", () => {
    const sessions = [
      makeSession({ id: "s1", title: "First" }),
      makeSession({ id: "s2", title: "Second" }),
      makeSession({ id: "s3", title: "Third" }),
    ];

    function renderList(onSelect = vi.fn(), selectedSessionId: string | null = null) {
      render(
        <>
          <SessionList
            mode="learn"
            sessions={sessions}
            selectedSessionId={selectedSessionId}
            onSelect={onSelect}
            adviceSelection={new Set()}
            onToggleAdvice={vi.fn()}
          />
          <button type="button">after</button>
        </>,
      );
      return onSelect;
    }

    it("keeps the card and its advice checkbox apart, so neither control is nested in the other", () => {
      renderList();

      const card = screen.getByRole("button", { name: "First" });
      expect(card).not.toContainElement(screen.getByRole("checkbox", { name: /First/ }));
    });

    it("is one stop in the Tab order (the selected card, then its checkbox), entered after the search box", async () => {
      const user = userEvent.setup();
      renderList(vi.fn(), "s2");

      await user.click(screen.getByPlaceholderText("Search…"));
      await user.tab();
      expect(screen.getByRole("button", { name: "Second" })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole("checkbox", { name: /Second/ })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole("button", { name: "after" })).toHaveFocus();
    });

    it("moves focus with ArrowDown/ArrowUp, Home and End, and opens with Enter", async () => {
      const user = userEvent.setup();
      const onSelect = renderList();
      screen.getByRole("button", { name: "First" }).focus();

      await user.keyboard("{ArrowDown}");
      expect(screen.getByRole("button", { name: "Second" })).toHaveFocus();
      expect(onSelect).not.toHaveBeenCalled();
      await user.keyboard("{End}");
      expect(screen.getByRole("button", { name: "Third" })).toHaveFocus();
      await user.keyboard("{ArrowUp}{Home}");
      expect(screen.getByRole("button", { name: "First" })).toHaveFocus();

      await user.keyboard("{ArrowDown}{Enter}");
      expect(onSelect).toHaveBeenCalledWith(sessions[1]);
    });

    it("marks the open session for assistive tech", () => {
      renderList(vi.fn(), "s3");

      expect(screen.getByRole("button", { name: "Third" })).toHaveAttribute("aria-current", "true");
      expect(screen.getByRole("button", { name: "First" })).not.toHaveAttribute("aria-current");
    });
  });
});
