import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeAuditRollup } from "../test-support/audit-fixture.js";
import { AuditRollupPanel } from "./AuditRollupPanel.js";

const NOW = new Date("2026-09-27T12:00:00.000Z");

function renderPanel(loadRollup = vi.fn().mockResolvedValue(makeAuditRollup())) {
  const onOpenSession = vi.fn();
  render(<AuditRollupPanel loadRollup={loadRollup} onOpenSession={onOpenSession} now={NOW} />);
  return { loadRollup, onOpenSession };
}

describe("AuditRollupPanel", () => {
  it("defaults to the last 30 days and shows headline tiles", async () => {
    const { loadRollup } = renderPanel();

    expect(await screen.findByRole("group", { name: "Sessions" })).toHaveTextContent("2");
    expect(loadRollup).toHaveBeenCalledWith({ since: "2026-08-28" }, expect.any(AbortSignal));
    expect(screen.getByRole("group", { name: "Failure rate" })).toHaveTextContent("40%");
    expect(screen.getByRole("group", { name: "Most failing program" })).toHaveTextContent("npm");
  });

  it("says how many Agent Host sessions are not included, since their tool calls are unknown", async () => {
    renderPanel(vi.fn().mockResolvedValue(makeAuditRollup({ sessionsWithUnknownToolCalls: 2 })));

    expect(await screen.findByRole("note")).toHaveTextContent("2 Agent Host sessions not included: no Copilot CLI event log.");
  });

  it("uses the singular for one Agent Host session", async () => {
    renderPanel(vi.fn().mockResolvedValue(makeAuditRollup({ sessionsWithUnknownToolCalls: 1 })));

    expect(await screen.findByRole("note")).toHaveTextContent("1 Agent Host session not included: no Copilot CLI event log.");
  });

  it("keeps the note when only Agent Host sessions are in range", async () => {
    renderPanel(
      vi.fn().mockResolvedValue(
        makeAuditRollup({ sessionCount: 0, sessionsWithUnknownToolCalls: 3, sessions: [], totals: { toolCalls: 0, succeeded: 0, failed: 0, interrupted: 0, denied: 0, unknown: 0 } }),
      ),
    );

    expect(await screen.findByText(/3 Agent Host sessions not included/)).toBeInTheDocument();
  });

  it("shows no note when every session's tool calls are known", async () => {
    renderPanel();
    await screen.findByRole("group", { name: "Sessions" });
    expect(screen.queryByText(/Agent Host session/)).not.toBeInTheDocument();
  });

  it("loads exactly once without an injected clock (regression: re-render loop)", async () => {
    const loadRollup = vi.fn().mockResolvedValue(makeAuditRollup());
    render(<AuditRollupPanel loadRollup={loadRollup} onOpenSession={vi.fn()} />);

    expect(await screen.findByRole("group", { name: "Sessions" })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(loadRollup).toHaveBeenCalledTimes(1);
  });

  it("reloads for another range preset", async () => {
    const { loadRollup } = renderPanel();
    await screen.findByRole("group", { name: "Sessions" });

    fireEvent.click(screen.getByLabelText("7 days"));
    await waitFor(() => expect(loadRollup).toHaveBeenLastCalledWith({ since: "2026-09-20" }, expect.any(AbortSignal)));

    fireEvent.click(screen.getByLabelText("All time"));
    await waitFor(() => expect(loadRollup).toHaveBeenLastCalledWith({}, expect.any(AbortSignal)));
  });

  it("charts outcomes per day", async () => {
    renderPanel();
    expect(await screen.findByRole("button", { name: "Day 09-27: 3 succeeded, 2 failed, 1 interrupted" })).toBeInTheDocument();
  });

  it("ranks the top failing commands with their category", async () => {
    renderPanel();

    const table = await screen.findByRole("table", { name: "Top failing commands" });
    const [first] = within(table).getAllByRole("row").slice(1);
    expect(first).toHaveTextContent("npm run build");
    expect(first).toHaveTextContent("Wrong directory");
    expect(first).toHaveTextContent("2");
  });

  it("opens a session's audit from the sessions table", async () => {
    const { onOpenSession } = renderPanel();

    const table = await screen.findByRole("table", { name: "Sessions" });
    fireEvent.click(within(table).getByRole("button", { name: "Fix the build" }));

    expect(onOpenSession).toHaveBeenCalledWith("a");
  });

  it("never shows a 0% failure rate for a session whose outcomes are all unknown", async () => {
    renderPanel(
      vi.fn().mockResolvedValue(
        makeAuditRollup({ sessions: [{ sessionId: "v", title: "VS Code session", toolCalls: 5, failed: 0, unknown: 5 }] }),
      ),
    );
    const table = await screen.findByRole("table", { name: "Sessions" });
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent(/—$/);
  });

  it("shows an empty state when no session falls in the range", async () => {
    renderPanel(vi.fn().mockResolvedValue(makeAuditRollup({ sessionCount: 0, sessions: [], daily: [], failureRate: null })));
    expect(await screen.findByText("No sessions in this date range.")).toBeInTheDocument();
  });

  it("reports a load error", async () => {
    renderPanel(vi.fn().mockRejectedValue(new Error("offline")));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
  });

  // §3.5 States (AsyncView).
  it("retries a failed load", async () => {
    const { loadRollup } = renderPanel(vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(makeAuditRollup()));

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("group", { name: "Sessions" })).toHaveTextContent("2");
    expect(loadRollup).toHaveBeenCalledTimes(2);
  });

  it("offers all time as the empty range's next step", async () => {
    const { loadRollup } = renderPanel(
      vi.fn().mockResolvedValue(makeAuditRollup({ sessionCount: 0, sessions: [], daily: [], failureRate: null })),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Show all time" }));

    await waitFor(() => expect(loadRollup).toHaveBeenLastCalledWith({}, expect.any(AbortSignal)));
    expect(screen.getByLabelText("All time")).toBeChecked();
  });

  it("lets a slow load be cancelled, says so without an error alert, and retries", async () => {
    const user = userEvent.setup();
    const signals: AbortSignal[] = [];
    const loadRollup = vi.fn((_query: unknown, signal: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1 ? new Promise<never>(() => undefined) : Promise.resolve(makeAuditRollup());
    });
    render(<AuditRollupPanel loadRollup={loadRollup} onOpenSession={vi.fn()} now={NOW} />);

    await user.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(signals[0].aborted).toBe(true);
    expect(screen.getByRole("heading", { name: "Loading cancelled" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("group", { name: "Sessions" })).toBeInTheDocument();
    expect(loadRollup).toHaveBeenCalledTimes(2);
  });
});
