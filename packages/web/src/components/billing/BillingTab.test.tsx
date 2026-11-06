import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { diffStatements, type StatementAnswer } from "@agent-cost-analyzer/domain";
import { sampleStatement } from "../../test-support/statement-sample.js";
import { BillingTab } from "./BillingTab.js";

// Phase 15 step 15.11 (plan §8.5, §11.5; board 4): the Billing tab. The draft
// statement with exact dates, Issue behind a confirmation (it writes a
// file), export with a preview, the frozen copy tagged with its diff, and the
// "no projects" empty state with Create project (S1).

const NOW = new Date("2026-11-06T12:00:00.000Z");
const PROJECTS = [
  { id: "portal", name: "Customer portal" },
  { id: "billing", name: "Billing service" },
];

const draftAnswer = (): StatementAnswer => ({ statement: sampleStatement(), canIssue: { ok: true }, issuedPeriods: [] });
const issuedAnswer = (late = false): StatementAnswer => {
  const issued = sampleStatement({ status: "issued", issuedAt: "2026-11-02T09:00:00.000Z" });
  const rerun = late ? sampleStatement({ totals: [{ currency: "AI_CREDITS", lines: 150, markup: 12, fixed: 0, total: 162 }, issued.totals[1]!], lines: [{ ...issued.lines[0]!, amount: 150 }] }) : sampleStatement();
  return { statement: issued, rerun, diff: diffStatements(issued, rerun), canIssue: { ok: false, reason: "Already issued on 2026-11-02T09:00:00.000Z; a frozen statement is never changed." }, issuedPeriods: ["2026-10"] };
};

function renderTab(props: Partial<Parameters<typeof BillingTab>[0]> = {}) {
  const loadStatement = props.loadStatement ?? vi.fn().mockResolvedValue(draftAnswer());
  const issue = props.issue ?? vi.fn().mockResolvedValue(issuedAnswer());
  const onEditProjects = vi.fn();
  const copyToClipboard = vi.fn().mockResolvedValue(undefined);
  render(<BillingTab projects={PROJECTS} selections={{ project: ["portal"] }} now={NOW} loadStatement={loadStatement} issue={issue} onEditProjects={onEditProjects} copyToClipboard={copyToClipboard} {...props} />);
  return { loadStatement, issue, onEditProjects, copyToClipboard };
}

describe("BillingTab (plan §11.5, board 4)", () => {
  it("offers Create project when there are no projects (S1)", async () => {
    const user = userEvent.setup();
    const { onEditProjects, loadStatement } = renderTab({ projects: [] });
    expect(screen.getByText("Group repositories into a project to bill and compare them.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create project" }));
    expect(onEditProjects).toHaveBeenCalled();
    expect(loadStatement).not.toHaveBeenCalled();
  });

  it("loads the selected project's last ended month by default", async () => {
    const { loadStatement } = renderTab();
    await screen.findByRole("table", { name: /Statement lines/ });
    expect(loadStatement).toHaveBeenCalledWith({ projectId: "portal", period: "2026-10" }, expect.any(AbortSignal));
    expect(screen.getByRole("combobox", { name: "Project" })).toHaveValue("portal");
    expect(screen.getByRole("combobox", { name: "Period" })).toHaveValue("2026-10");
  });

  it("shows the draft with exact dates, lines, unknown cost (never 0), totals per currency, the user currency and provenance", async () => {
    renderTab();
    expect(await screen.findByRole("heading", { name: "Customer portal · 2026-10-01 to 2026-10-31 (Europe/Tallinn)" })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: /Statement lines/ });
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent(/GitHub Copilot.*gpt-5\.5.*billed.*5.*120\.00 AI Credits/);
    expect(table).toHaveTextContent("1 turn, cost unknown: Cannot price: unknown model. Not counted as 0.");
    const totals = screen.getByRole("table", { name: "Totals" });
    expect(totals).toHaveTextContent(/AI Credits.*120\.00.*12\.00.*0\.00.*132\.00/);
    expect(screen.getByText(/EUR 36\.29/)).toBeInTheDocument();
    expect(screen.getByText("Provenance")).toBeInTheDocument();
  });

  it("issues only after confirming in a dialog, then shows the frozen copy", async () => {
    const user = userEvent.setup();
    const loadStatement = vi.fn().mockResolvedValueOnce(draftAnswer()).mockResolvedValue(issuedAnswer());
    const { issue } = renderTab({ loadStatement });
    await user.click(await screen.findByRole("button", { name: "Issue statement" }));
    const dialog = screen.getByRole("dialog", { name: "Issue the October 2026 statement?" });
    expect(dialog).toHaveTextContent(/never changes/);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(issue).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Issue statement" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Issue statement" }));
    await waitFor(() => expect(issue).toHaveBeenCalledWith("portal", "2026-10"));
    const card = await screen.findByRole("region", { name: /^Customer portal ·/ });
    expect(within(card).getByText("Frozen")).toBeInTheDocument();
  });

  it("can't issue an open period, and says why", async () => {
    const loadStatement = vi.fn().mockResolvedValue({ ...draftAnswer(), canIssue: { ok: false, reason: "November 2026 hasn't ended yet in Europe/Tallinn; it can be issued from 2026-12-01." } });
    renderTab({ loadStatement });
    expect(await screen.findByText(/hasn't ended yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Issue statement" })).not.toBeInTheDocument();
  });

  it("tags a frozen statement and, when a re-run differs, warns and shows the exact diff", async () => {
    const user = userEvent.setup();
    renderTab({ loadStatement: vi.fn().mockResolvedValue(issuedAnswer(true)) });
    const card = await screen.findByRole("region", { name: /^Customer portal ·/ });
    expect(within(card).getByText("Frozen")).toBeInTheDocument();
    expect(screen.getByText("Differs from issued")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View diff" }));
    const diff = screen.getByRole("table", { name: "Differences from the issued statement" });
    expect(diff).toHaveTextContent(/AI Credits.*132\.00.*162\.00.*\+30\.00/);
    expect(screen.getByRole("list", { name: "Issued statements" })).toHaveTextContent("October 2026");
  });

  it("exports CSV, JSON or Markdown with a preview, copying it, titles optional", async () => {
    const user = userEvent.setup();
    const { copyToClipboard } = renderTab();
    await user.click(await screen.findByRole("button", { name: "Export…" }));
    const dialog = screen.getByRole("dialog", { name: /Export/ });
    expect(within(dialog).getByLabelText("Preview")).toHaveTextContent(/^kind,basis,currency/);
    await user.click(within(dialog).getByRole("radio", { name: "Markdown" }));
    expect(within(dialog).getByLabelText("Preview")).toHaveTextContent("# Statement: Customer portal, October 2026");
    expect(within(dialog).getByLabelText("Preview")).toHaveTextContent("Fix the bug");
    await user.click(within(dialog).getByRole("checkbox", { name: "Include session titles" }));
    expect(within(dialog).getByLabelText("Preview")).not.toHaveTextContent("Fix the bug");
    await user.click(within(dialog).getByRole("button", { name: "Copy" }));
    expect(copyToClipboard).toHaveBeenCalledWith(expect.stringContaining("# Statement"));
    expect(within(dialog).getByRole("link", { name: /Save/ })).toHaveAttribute("download", "portal-2026-10.md");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
