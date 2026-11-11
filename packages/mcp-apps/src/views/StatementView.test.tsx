// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ViewBrand } from "../brand/view-brand.js";
import type { ToolResult } from "../host/app-host-port.js";
import { FakeAppHostPort } from "../host/fake-app-host-port.js";
import { issuedAnswerWithDiff, statement, statementAnswer } from "../view-models/increment3-fixtures.js";
import { StatementView } from "./StatementView.js";

const brand: ViewBrand = { productId: "standalone", displayName: "Agent Cost Analyzer", version: "0.12.0" };
const extension: ViewBrand = { productId: "vscode-extension", displayName: "AI Credits Analyzer", version: "0.8.0" };
const ok = (structuredContent: unknown): ToolResult => ({ structuredContent });

function setup(result: ToolResult | "waiting" = ok(statementAnswer()), viewBrand: ViewBrand = brand) {
  const port = new FakeAppHostPort();
  return { port, ...render(<StatementView port={port} brand={viewBrand} result={result === "waiting" ? undefined : result} />) };
}

describe("U14 StatementView, a draft", () => {
  it("names the project, the period, the status and the client", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1, name: "Customer portal · October 2026" })).toBeInTheDocument();
    expect(screen.getByText("Agent Cost Analyzer · Statement")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText(/ACME · billing code AC-7/)).toBeInTheDocument();
    expect(screen.getByText("Read-only · local logs · v0.12.0")).toBeInTheDocument();
  });

  it("has one table per currency, AI Credits first, with the five columns of Q13", () => {
    setup();
    const tables = screen.getAllByRole("table");
    expect(tables.map((table) => within(table).getByRole("columnheader", { name: /^(AI Credits|USD)$/ }).textContent)).toEqual(["AI Credits", "USD"]);
    const credits = within(screen.getByRole("table", { name: "Statement lines in AI Credits" }));
    expect(credits.getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Basis", "Channel", "Model", "Turns", "AI Credits"]);
    expect(credits.getByText("gpt-5.5")).toBeInTheDocument();
    expect(credits.getByText("no channel")).toBeInTheDocument();
    expect(credits.queryByText(/cache|token|unit price/i)).not.toBeInTheDocument();
  });

  it("hides the Channel column at 480 px and below, in CSS", () => {
    const css = readFileSync(path.join(__dirname, "statement/statement.css"), "utf8");
    expect(css).toMatch(/@media \(max-width: 480px\)\s*{[^}]*\.stm-col-channel\s*{\s*display:\s*none/);
    setup();
    for (const cell of document.querySelectorAll("td.stm-col-channel, th.stm-col-channel")) expect(cell).toBeInTheDocument();
  });

  it("shows totals per currency: lines, markup, fixed and total", () => {
    setup();
    const credits = within(screen.getByRole("group", { name: "Total, AI Credits" }));
    expect(credits.getByText("165.00")).toBeInTheDocument();
    expect(credits.getByText(/lines 150\.00 \+ markup 15\.00 \+ fixed 0\.00/)).toBeInTheDocument();
    const usd = within(screen.getByRole("group", { name: "Total, USD" }));
    expect(usd.getByText("$43.50")).toBeInTheDocument();
    expect(usd.getByText(/fixed \$39\.00/)).toBeInTheDocument();
    expect(screen.getByText("Fixed: Seats")).toBeInTheDocument();
  });

  it("counts unknown turns with the reason, as Unknown and never 0, and names the excluded group", () => {
    setup();
    const unknown = within(screen.getByRole("region", { name: "No known cost" }));
    expect(unknown.getByText(/1 turn in 1 session: No cost figure in the log\. Their cost is/)).toBeInTheDocument();
    expect(unknown.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText(/Left off: 2 turns in 1 session, Subscription use \(API-equivalent\)\./)).toBeInTheDocument();
  });

  it("states the coverage when some turns are unknown", () => {
    setup();
    expect(screen.getAllByText(/known for 9 of 10 turns/).length).toBeGreaterThan(0);
  });

  it("says a draft is not issued and why it cannot be issued yet", () => {
    setup(ok(statementAnswer({ canIssue: { ok: false, reason: "November has not ended in Europe/Tallinn." } })));
    expect(screen.getByRole("status")).toHaveTextContent("Not issued. A draft is built from the logs when asked and can change. It can't be issued yet: November has not ended in Europe/Tallinn.");
  });

  it("has no control at all, and says issuing is done in the app", () => {
    setup();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/Statements are issued in the Agent Cost Analyzer app\. This view cannot issue or change one\. 1 AI Credit = \$0\.01/)).toBeInTheDocument();
    expect(screen.queryByText(/re-issue|export/i)).not.toBeInTheDocument();
  });
});

describe("U14 StatementView, an issued statement with a diff", () => {
  const issued = () => setup(ok(issuedAnswerWithDiff()));

  it("shows the issued date and the amber alert that the issued copy stays the record", () => {
    issued();
    expect(screen.getByText(/Issued Nov 2/)).toBeInTheDocument();
    const alert = screen.getByText("A re-run today differs from the issued copy.").closest("[role=status]");
    expect(alert).toHaveTextContent("The issued copy stays the statement of record.");
    expect(alert).toHaveClass("stm-alert--warn");
  });

  it("shows issued, re-run and difference per line and per currency total", () => {
    issued();
    const table = within(screen.getByRole("table", { name: "Issued against re-run, per line" }));
    const changed = table.getByText("billed, github-copilot, gpt-5.5").closest("tr")!;
    expect(within(changed).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["billed, github-copilot, gpt-5.5", "120.00 AI Credits", "128.00 AI Credits", "+8.00 AI Credits"]);
    const credits = table.getByText("Total, AI Credits").closest("tr")!;
    expect(within(credits).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Total, AI Credits", "165.00 AI Credits", "150.80 AI Credits", "−14.20 AI Credits"]);
    expect(table.getByText("Total, USD")).toBeInTheDocument();
  });

  it("calls an added line 'no earlier figure', never 'from 0', and tags added and removed lines", () => {
    const { container } = issued();
    const added = screen.getByText("priced, anthropic-api, claude-haiku-5.5").closest("tr")!;
    expect(within(added).getByText("added")).toBeInTheDocument();
    expect(within(added).getByText("no earlier figure")).toBeInTheDocument();
    expect(within(screen.getByText("billed, no channel, o4").closest("tr")!).getByText("removed")).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/from 0/i);
  });

  it("lists added sessions, unknown turns and what changed in the inputs", () => {
    issued();
    const list = within(screen.getByRole("list", { name: "What else changed" }));
    expect(list.getByText("1 session added, none removed")).toBeInTheDocument();
    expect(list.getByText("unknown turns 1 → 2")).toBeInTheDocument();
    expect(list.getByText("The price book changed")).toBeInTheDocument();
  });

  it("says so, with no alert, when the re-run matches", () => {
    const answer = issuedAnswerWithDiff();
    setup(ok({ ...answer, diff: { ...answer.diff, changed: false, lines: [] } }));
    expect(screen.getByText("A re-run today matches the issued copy.")).toBeInTheDocument();
    expect(screen.queryByText(/differs from the issued copy/)).not.toBeInTheDocument();
  });

  it("offers no issue, re-issue or export control, and no reason to issue", () => {
    issued();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/can't be issued yet/)).not.toBeInTheDocument();
    expect(screen.getByText(/Issued periods: 2026-09\./)).toBeInTheDocument();
  });
});

describe("U14 StatementView, states and the extension", () => {
  it("waits for the result", () => {
    setup("waiting");
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for the statement");
  });

  it("shows the tool's error as text, and an unreadable result as an error", () => {
    const first = setup({ isError: true, errorText: "Unknown project id nope" });
    expect(screen.getByRole("alert")).toHaveTextContent("The tool returned an error: Unknown project id nope");
    first.unmount();
    setup(ok({ nothing: true }));
    expect(screen.getByRole("alert")).toHaveTextContent("this view can't read");
  });

  // A32: capped at 500 characters, as the other views' error text is.
  it("caps a long error text", () => {
    setup({ isError: true, errorText: `Unknown project id nope ${"x".repeat(900)}` });
    expect(screen.getByRole("alert").textContent!.length).toBeLessThan(600);
  });

  it("shows nothing billing-related in the extension, even with a result", () => {
    const { container } = setup(ok(issuedAnswerWithDiff()), extension);
    expect(screen.getByRole("heading", { level: 1, name: "No view for this result" })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/statement|billing|issued|AI Credits$|Customer portal|ACME|AC-7|markup|USD/i);
    expect(container.querySelector("table")).toBeNull();
  });

  it("keeps the model's own project name out of the extension too", () => {
    const answer = statementAnswer({ statement: statement({ project: { id: "p", name: "Secret Client Project" } }) });
    const { container } = setup(ok(answer), extension);
    expect(container).not.toHaveTextContent("Secret Client Project");
  });
});
