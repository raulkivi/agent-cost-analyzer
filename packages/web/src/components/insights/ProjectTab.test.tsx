import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { InsightFinding, InsightTurnRow } from "@agent-cost-analyzer/domain";
import { COST_FIXTURE_NOW, sampleCostVariance, sampleProjectCost } from "../../test-support/cost-fixture.js";
import { ProjectTab } from "./ProjectTab.js";

// Phase 15 step 15.10 (plan §8.3, §8.4, §11.4; board 3): the Dashboard's
// Project tab: cost by vendor, a vendor's models and tokens by type, the
// price-versus-usage waterfall between two months, and the billed-versus-
// priced reconciliation with observed price changes as findings.

const PLACEHOLDERS = { project: "(no-project)", repository: "(unattributed)" };

const finding: InsightFinding = {
  key: "price-change:github-copilot:gpt-5.5:2026-10-05",
  sessionKey: "vscode:s1",
  kind: "price-change",
  category: "observed-price-change",
  severity: "medium",
  ruleId: "pricing.observed-change",
  title: "Observed: gpt-5.5 billed 12% above the price book since 2026-10-05",
  at: "2026-10-05",
  why: "Inferred, not documented: GitHub billed 12% more than the price book gives.",
  evidence: "2026-W41: 20 turns, billed 224 vs priced 200 AI Credits (×1.12)",
};

const copilotTurn = (date: string, billed: number, priced: number): InsightTurnRow => ({
  key: `vscode:s1:${date}`,
  sessionKey: "vscode:s1",
  turnIndex: 0,
  model: "gpt-5.5",
  uncachedInput: 1,
  cacheWrite: 0,
  cacheRead: 0,
  reasoning: null,
  output: 1,
  aiCredits: billed,
  estimated: false,
  toolCallCount: 0,
  repositoryKey: "github.com/acme/portal-web",
  projectId: "portal",
  vendorId: "openai",
  channel: "github-copilot",
  date,
  cost: {
    billed: { known: true, amount: billed, currency: "AI_CREDITS", basis: "billed" },
    reported: { known: false, reason: "n/a" },
    priced: { known: true, amount: priced, currency: "AI_CREDITS", basis: "priced", priceVersionIds: ["v"] },
  },
});

function renderTab(props: Partial<Parameters<typeof ProjectTab>[0]> = {}) {
  const loadProjectCost = props.loadProjectCost ?? vi.fn().mockResolvedValue(sampleProjectCost());
  const loadVariance = props.loadVariance ?? vi.fn().mockResolvedValue(sampleCostVariance());
  render(
    <ProjectTab
      selections={{ project: ["portal"] }}
      fieldLabel={(field) => field[0]!.toUpperCase() + field.slice(1)}
      placeholders={PLACEHOLDERS}
      basis="preferred"
      now={COST_FIXTURE_NOW}
      findings={[finding]}
      turns={[copilotTurn("2026-09-10", 110, 100), copilotTurn("2026-10-10", 224, 200)]}
      loadProjectCost={loadProjectCost}
      loadVariance={loadVariance}
      {...props}
    />,
  );
  return { loadProjectCost, loadVariance };
}

describe("ProjectTab (plan §11.4, board 3)", () => {
  it("asks for one project to look inside", () => {
    const { loadProjectCost } = renderTab({ selections: {} });
    expect(screen.getByText("Select one project in the Project list box to see inside it.")).toBeInTheDocument();
    expect(loadProjectCost).not.toHaveBeenCalled();
  });

  it("loads the project's cost for the range in USD, and the variance between the range's first and last month", async () => {
    const { loadProjectCost, loadVariance } = renderTab({ selections: { project: ["portal"], provider: ["vscode"] } });
    await screen.findByRole("group", { name: /Cost by vendor/ });
    expect(loadProjectCost).toHaveBeenCalledWith(
      { projectId: "portal", since: "2026-08-09", until: "2026-11-06", basis: "preferred", pricing: "as-of-use", currency: "usd", provider: "vscode" },
      expect.any(AbortSignal),
    );
    expect(loadVariance).toHaveBeenCalledWith({ groupBy: "project", id: "portal", periodA: "2026-08", periodB: "2026-11", currency: "usd", provider: "vscode" }, expect.any(AbortSignal));
  });

  it("shows cost by vendor, and the first vendor's models and tokens by type; clicking a vendor shows its models", async () => {
    renderTab();
    const vendors = await screen.findByRole("group", { name: /Cost by vendor/ });
    expect(within(vendors).getByRole("button", { name: /Anthropic/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("group", { name: "Anthropic models" })).toHaveTextContent("claude-sonnet-5.5");
    expect(screen.getByRole("group", { name: "Anthropic tokens by type" })).toHaveTextContent("Cache read");
    await userEvent.click(within(vendors).getByRole("button", { name: /OpenAI/ }));
    expect(screen.getByRole("group", { name: "OpenAI models" })).toHaveTextContent("gpt-5.5");
  });

  it("draws the waterfall from period A to period B, with effects that add up, and says what it can't explain", async () => {
    renderTab();
    const chart = await screen.findByRole("img", { name: /Why cost changed: Aug 2026 to Nov 2026/ });
    expect(chart).toHaveAccessibleName(/usage \+4,130\.00, price −1,860\.00, mix \+610\.00/);
    expect(screen.getByText(/2 turns in Nov 2026 have no priced figure and are not explained/)).toBeInTheDocument();
    expect(screen.getByText(/Priced basis, as of use: usage is/)).toBeInTheDocument();
  });

  it("reloads the variance when another month is picked", async () => {
    const { loadVariance } = renderTab();
    await screen.findByRole("img", { name: /Why cost changed/ });
    await userEvent.selectOptions(screen.getByLabelText("From"), "2026-09");
    expect(loadVariance).toHaveBeenLastCalledWith(expect.objectContaining({ periodA: "2026-09", periodB: "2026-11" }), expect.any(AbortSignal));
  });

  it("lists observed price changes as inferred findings with their severity as text, and billed minus priced per model and month", async () => {
    renderTab();
    const section = await screen.findByRole("region", { name: "Reconciliation" });
    expect(within(section).getByText("Medium")).toBeInTheDocument();
    expect(within(section).getByText(finding.title)).toBeInTheDocument();
    const table = within(section).getByRole("table", { name: /Billed minus priced/ });
    expect(within(table).getAllByRole("row").map((row) => row.textContent)).toEqual(["ModelSep 2026Oct 2026", "gpt-5.5+10.00+24.00"]);
  });

  it("says when there is nothing to reconcile", async () => {
    renderTab({ findings: [], turns: [] });
    const section = await screen.findByRole("region", { name: "Reconciliation" });
    expect(section).toHaveTextContent("No Copilot turns with both a billed and a priced figure in this project and range.");
  });
});
