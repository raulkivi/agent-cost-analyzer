// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CostCompareGroupBy, Currency } from "@agent-cost-analyzer/domain";
import { useMemo, useState } from "react";
import type { ViewBrand } from "../brand/view-brand.js";
import type { AppHostPort, ToolResult } from "../host/app-host-port.js";
import type { ClipboardPort } from "../host/clipboard-port.js";
import { toCostComparisonViewModel } from "../view-models/index.js";
import type { CostComparisonViewModel } from "../view-models/index.js";
import { ErrorBox } from "./SessionCostView.js";
import { ViewShell } from "./ViewShell.js";
import { CompareDrillDown } from "./cost-compare/CompareDrillDown.js";
import { ComparisonTable } from "./cost-compare/ComparisonTable.js";
import type { OpenRow } from "./cost-compare/ComparisonTable.js";
import { NO_PROJECTS_REASON } from "./cost-compare/no-projects.js";
import { hasNothingToCompare, parseComparison } from "./cost-compare/parse-comparison.js";
import "./cost-compare/cost-compare.css";

// U10, which repository or project costs the most (plan §4.5, board
// CostCompare.dc.html). Renders the compare_costs result. A row calls
// get_repository_cost or get_project_cost through the port with the row's
// own arguments and swaps to U9 in place; this view stays mounted, so Back
// refetches nothing. Labels are logged-adjacent text: shown, never sent.

const KICKER = "Cost comparison";

const NOUN: Record<CostCompareGroupBy, { one: string; many: string }> = {
  repository: { one: "repository", many: "repositories" },
  project: { one: "project", many: "projects" },
};

const UNIT_TEXT: Record<Currency, string> = { AI_CREDITS: "AI Credits", USD: "USD" };

// The currencies any figure is in, AI Credits first.
function currenciesOf(vm: CostComparisonViewModel): Currency[] {
  const found = new Set<Currency>();
  for (const view of [...vm.total, ...vm.rows.flatMap((row) => row.total)]) if (view.known && view.currency !== null) found.add(view.currency);
  return (["AI_CREDITS", "USD"] as const).filter((currency) => found.has(currency));
}

function basisPhrase(vm: CostComparisonViewModel): string {
  return vm.basis === "preferred" ? "preferred basis: billed, then reported, then priced" : `${vm.basis} basis`;
}

function introText(vm: CostComparisonViewModel, currencies: readonly Currency[], plural: string): string {
  if (currencies.length === 0) return `No cost is known for these ${plural} on the ${basisPhrase(vm)}. Cache hit is cache-read tokens over input tokens.`;
  if (currencies.length === 1) return `All money in ${UNIT_TEXT[currencies[0]!]} on the ${basisPhrase(vm)}. Cache hit is cache-read tokens over input tokens.`;
  return `These ${plural} have costs in two currencies. Each money cell lists AI Credits first, then USD with a "$". The two are never added or converted, so Together has two totals. Preferred basis: billed, then reported, then priced. Cache hit is cache-read tokens over input tokens.`;
}

function NoRows({ brand, groupBy }: { brand: ViewBrand; groupBy: CostCompareGroupBy }) {
  if (groupBy === "project") {
    return (
      <ViewShell brand={brand} kicker={KICKER} title="No projects here" meta="project comparisons">
        <div className="cc-state">
          <p>{brand.productId === "vscode-extension" ? NO_PROJECTS_REASON : "There are no projects to compare."}</p>
          <h2>What to ask instead</h2>
          <p>Cost by repository works as usual: ask for a repository&apos;s cost, or compare repositories.</p>
        </div>
      </ViewShell>
    );
  }
  return (
    <ViewShell brand={brand} kicker={KICKER} title="Nothing to compare">
      <p className="cc-note-line text-muted">The result has no repositories. The text answer above is complete.</p>
    </ViewShell>
  );
}

export function CostCompareView({ port, brand, clipboard, result }: { port: AppHostPort; brand: ViewBrand; clipboard?: ClipboardPort | undefined; result: ToolResult | undefined }) {
  const comparison = useMemo(() => (result === undefined || result.isError ? undefined : parseComparison(result.structuredContent)), [result]);
  const vm = useMemo(() => (comparison === undefined ? undefined : toCostComparisonViewModel(comparison)), [comparison]);
  const [selected, setSelected] = useState<OpenRow | undefined>();
  // The row last opened, so Back can return focus to it.
  const [returnTo, setReturnTo] = useState<string | undefined>();

  if (result === undefined) {
    return (
      <ViewShell brand={brand} kicker={KICKER} title="Cost comparison">
        <p role="status" className="text-muted">
          Waiting for the cost comparison…
        </p>
      </ViewShell>
    );
  }
  if (result.isError) {
    const text = result.errorText?.trim();
    return (
      <ViewShell brand={brand} kicker={KICKER} title="Cost comparison">
        <ErrorBox title="Couldn't compare the costs.">{text === undefined || text === "" ? "The tool returned an error. The text answer above is complete." : `The tool returned an error: ${text.slice(0, 500)}`}</ErrorBox>
      </ViewShell>
    );
  }
  if (comparison === undefined || vm === undefined) {
    return (
      <ViewShell brand={brand} kicker={KICKER} title="Cost comparison">
        <ErrorBox title="Couldn't load the cost comparison.">The result is one this view can&apos;t read. The text answer above is complete.</ErrorBox>
      </ViewShell>
    );
  }
  // The extension answers project ids with rows that count nothing; the
  // result carries no reason, so the product's own is shown (plan §8.2).
  const noProjectsHere = comparison.groupBy === "project" && (comparison.rows.length === 0 || (brand.productId === "vscode-extension" && hasNothingToCompare(comparison)));
  if (noProjectsHere || comparison.rows.length === 0) return <NoRows brand={brand} groupBy={comparison.groupBy} />;

  if (selected !== undefined) {
    return <CompareDrillDown port={port} brand={brand} clipboard={clipboard} row={selected} onBack={() => setSelected(undefined)} />;
  }

  const noun = NOUN[vm.groupBy];
  const currencies = currenciesOf(vm);
  const meta = `${vm.periodText} vs ${vm.previousPeriodText} (${vm.comparePeriodText}) · ${vm.pricingText}`;
  return (
    <ViewShell brand={brand} kicker={KICKER} title={`${vm.rows.length} ${vm.rows.length === 1 ? noun.one : noun.many} compared`} meta={meta}>
      <p className="cc-note-line text-muted">{introText(vm, currencies, noun.many)}</p>
      {vm.providerIssues.length > 0 && (
        <ul className="cc-issues" aria-label="Logs not fully read">
          {vm.providerIssues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}

      <section className="view-section" aria-label={`Cost by ${noun.one}`}>
        <div className="view-section-head">
          <h2>{`Cost by ${noun.one}`}</h2>
          <span className="text-muted">click a row to open it here</span>
        </div>
        <ComparisonTable
          vm={vm}
          noun={noun.one}
          focusOnMount={returnTo}
          onOpen={(row) => {
            setSelected(row);
            setReturnTo(row.key);
          }}
        />
      </section>

      {vm.undatedNote !== undefined && <p className="cc-note-line text-muted">{`${vm.undatedNote[0]!.toUpperCase()}${vm.undatedNote.slice(1)}.`}</p>}
      {vm.conversionNote !== undefined && <p className="cc-note-line text-muted">{vm.conversionNote}</p>}
    </ViewShell>
  );
}
