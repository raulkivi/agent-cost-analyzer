// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Session } from "@agent-cost-analyzer/domain";
import type { Mode } from "../state/session-store.js";
import { formatAiCredits } from "../lib/format-ai-credits.js";
import { formatRelativeTime } from "../lib/format-relative-time.js";
import { onKeyActivate } from "../lib/on-key-activate.js";
import { sessionListSubagentLine } from "../lib/subagent-runs.js";
import { Blueprint } from "./ui/Blueprint.js";

interface SessionListProps {
  mode: Mode;
  sessions: Session[];
  selectedSessionId: string | null;
  onSelect: (session: Session) => void;
  adviceSelection?: Set<string>;
  onToggleAdvice?: (session: Session) => void;
}

// The card's small label: a scenario's category, or when a session started.
// Not the mode, which the mode switch already shows (step 10.11).
function kicker(mode: Mode, session: Session): string | undefined {
  if (mode === "learn") return session.category;
  return session.startedAt ? formatRelativeTime(session.startedAt) : undefined;
}

// Keys that move focus through the cards (§3.5 Accessibility), to an index.
function targetIndex(key: string, current: number, count: number): number | undefined {
  switch (key) {
    case "ArrowDown":
      return Math.min(current + 1, count - 1);
    case "ArrowUp":
      return Math.max(current - 1, 0);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return undefined;
  }
}

export function SessionList({
  mode,
  sessions,
  selectedSessionId,
  onSelect,
  adviceSelection,
  onToggleAdvice,
}: SessionListProps) {
  const [query, setQuery] = useState("");
  // The card arrow keys last moved to; the list's one Tab stop.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const cards = useRef(new Map<string, HTMLButtonElement>());
  const filtered = sessions.filter((session) =>
    session.title.toLowerCase().includes(query.toLowerCase()),
  );
  // Roving tabindex: the list is entered at the card last focused, else the
  // open session's, else the first.
  const tabStopId =
    [focusedId, selectedSessionId].find((id) => filtered.some((session) => session.id === id)) ?? filtered[0]?.id;

  function handleCardKeyDown(event: KeyboardEvent, index: number): void {
    const target = targetIndex(event.key, index, filtered.length);
    if (target === undefined) {
      onKeyActivate(() => onSelect(filtered[index]!))(event);
      return;
    }
    event.preventDefault();
    const id = filtered[target]!.id;
    setFocusedId(id);
    cards.current.get(id)?.focus();
  }

  return (
    <div>
      <h6 className="session-list-heading">
        {mode === "learn" ? "Scenarios" : "Sessions"}
      </h6>
      <div className="field session-list-search">
        <input
          className="input"
          placeholder="Search…"
          aria-label={mode === "learn" ? "Search scenarios" : "Search sessions"}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {/* One frame round the whole list; per-row frames made 88-120px rows. */}
      <Blueprint>
        <ul className="session-list" aria-label={mode === "learn" ? "Scenarios" : "Sessions"}>
          {filtered.map((session, index) => {
            const tabIndex = session.id === tabStopId ? 0 : -1;
            const selected = session.id === selectedSessionId;
            const kickerText = kicker(mode, session);
            return (
              <li key={session.id} className={selected ? "session-row session-row--selected" : "session-row"}>
                {/* The row button and its advice checkbox are siblings, not one
                    inside the other (no nested interactive controls). */}
                <button
                  ref={(element) => {
                    if (element) cards.current.set(session.id, element);
                    else cards.current.delete(session.id);
                  }}
                  type="button"
                  className={onToggleAdvice ? "session-card-button session-card-button--with-check" : "session-card-button"}
                  tabIndex={tabIndex}
                  aria-label={session.title}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(session)}
                  onKeyDown={(event) => handleCardKeyDown(event, index)}
                  onFocus={() => setFocusedId(session.id)}
                >
                  <span className="card-title truncate session-row-title" title={session.title}>{session.title}</span>
                  <span className="session-row-meta">
                    {kickerText && (
                      <>
                        <span className="card-kicker">{kickerText}</span>
                        {" · "}
                      </>
                    )}
                    {session.turnCount} {session.turnCount === 1 ? "turn" : "turns"}
                    {session.costAiCredits.known && <> · {formatAiCredits(session.costAiCredits)} AI Credits</>}
                  </span>
                  {/* A cost explanation, so it stays visible (never hide estimate/unknown labels). */}
                  {session.subagentSpend && (
                    <span className="session-row-note">{sessionListSubagentLine(session.subagentSpend)}</span>
                  )}
                </button>
                {onToggleAdvice && (
                  <label title="Select for advice export" className="session-row-check">
                    <input
                      type="checkbox"
                      tabIndex={tabIndex}
                      aria-label={`Select ${session.title} for advice`}
                      checked={adviceSelection?.has(session.id) ?? false}
                      onChange={() => onToggleAdvice(session)}
                    />
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      </Blueprint>
      {filtered.length === 0 && (
        <p className="text-muted session-list-empty">
          No matches.
        </p>
      )}
    </div>
  );
}
