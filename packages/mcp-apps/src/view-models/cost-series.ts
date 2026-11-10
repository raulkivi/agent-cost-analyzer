// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CostBasisChoice, CostBreakdownRow, CostBucket, CostPoint, CostSeries, Currency, ObservedPriceChange, ProjectCost, VendorCostBreakdown } from "@agent-cost-analyzer/domain";
import { documentedPriceChange, conversionNoteFor, pricingText, providerIssues } from "./analysis-common.js";
import type { DocumentedPriceChange } from "./analysis-common.js";
import { formatDay, formatSignedPercent, formatTokens, measureView, periodText, pluralize } from "./format.js";
import type { MeasureView } from "./format.js";
import { basisText, moneyViews } from "./money.js";
import type { MoneyView } from "./money.js";

// U9, cost over time for a repository or project (docs/plans/mcp-apps.md
// §2, §4.5). Pure: formats a get_repository_cost or get_project_cost
// result. Every money figure names its basis and currency; an unknown
// bucket is a gap; observed price changes are "inferred" and kept apart
// from documented ones. Drill-down arguments come only from the input.

export interface BasisTile {
  basis: CostBasisChoice;
  basisText: string;
  money: MoneyView[];
  basisNote?: string; // preferred only: which basis each turn's figure came from
}

export interface PointView {
  period: string;
  label: string;
  start: string;
  end: string;
  turns: number;
  unknown: boolean; // nothing known in this bucket: drawn as a gap
  cost: MoneyView[];
  cumulative: MoneyView[];
}

export interface ObservedPriceChangeMarker {
  kind: "observed";
  inferred: true;
  label: "inferred";
  date: string;
  dateText: string;
  channel: string;
  modelId: string;
  direction: "above" | "below"; // billed above or below the price book
  percentText: string;
  weeksText: string;
}

export type PriceMarker = (DocumentedPriceChange | ObservedPriceChangeMarker) & { period?: string }; // period: the bucket it falls in

export interface BreakdownRowView {
  key: string | null;
  label: string;
  reason?: string;
  turnsText: string;
  money: MoneyView[];
  // Share of the known vendor total in each currency; none for an unknown row.
  shares: Partial<Record<Currency, string>>;
}

export interface VendorRowView extends BreakdownRowView {
  models: BreakdownRowView[];
}

export interface TokenTypeRow {
  model: string;
  vendorId: string | null;
  uncachedInput: MeasureView;
  cacheWrite: MeasureView;
  cacheRead: MeasureView;
  reasoning: MeasureView;
  output: MeasureView;
}

export interface TopSessionView {
  providerId: string;
  sessionId: string;
  model: string;
  turnsText: string;
  startedText?: string;
  cost: MoneyView[];
  drillDown: { tool: "get_session_cost"; arguments: { sessionId: string; provider: string } };
  displayOnly: { title: string }; // logged text: display only, never forwarded to the model
}

export interface ProjectPart {
  byRepository: BreakdownRowView[];
  byTokenType: TokenTypeRow[];
  topSessions: TopSessionView[];
}

export interface CostSeriesViewModel {
  kind: "repository" | "project";
  title: string;
  projectId?: string;
  periodText?: string;
  bucket: CostBucket;
  bucketText: string;
  basis: CostBasisChoice;
  basisText: string;
  pricingText: string;
  conversionNote?: string;
  sessionsText: string;
  turnsText: string;
  undatedNote?: string;
  providerIssues: string[];
  total: MoneyView[];
  basisTiles: BasisTile[];
  chart: { currencies: Currency[]; points: PointView[] };
  markers: PriceMarker[];
  byVendor: VendorRowView[];
  project?: ProjectPart;
}

const BUCKET_TEXT: Record<CostBucket, string> = { day: "daily", week: "weekly", month: "monthly" };
const BASES = ["preferred", "billed", "reported", "priced"] as const;

function breakdownRow(row: CostBreakdownRow, view: CostSeries): BreakdownRowView {
  return {
    key: row.key,
    label: row.label,
    ...(row.reason === undefined ? {} : { reason: row.reason }),
    turnsText: pluralize(row.turns, "turn"),
    money: moneyViews(row.cost, view.basis, view.currency),
    shares: {},
  };
}

function vendorRow(row: VendorCostBreakdown, view: CostSeries): VendorRowView {
  return { ...breakdownRow(row, view), models: row.models.map((model) => breakdownRow(model, view)) };
}

const knownAmount = (money: MoneyView[], currency: Currency): number | null => money.find((view) => view.currency === currency && view.known)?.amount ?? null;

// Vendors and their models against the known vendor total, per currency. An
// unknown row has no share and adds nothing; a zero total divides nothing.
function addShares(vendors: VendorRowView[]): void {
  const currencies = [...new Set(vendors.flatMap((vendor) => vendor.money.flatMap((money) => (money.known && money.currency !== null ? [money.currency] : []))))];
  for (const currency of currencies) {
    const grand = vendors.reduce((sum, vendor) => sum + (knownAmount(vendor.money, currency) ?? 0), 0);
    if (grand <= 0) continue;
    for (const row of [...vendors, ...vendors.flatMap((vendor) => vendor.models)]) {
      const amount = knownAmount(row.money, currency);
      if (amount !== null) row.shares[currency] = `${Math.round((amount / grand) * 100)} %`;
    }
  }
}

function basisNote(view: CostSeries): string | undefined {
  const { billed, reported, priced, unknown } = view.totals.preferredBasisTurns;
  const parts = [
    billed > 0 ? `billed for ${billed} ${billed === 1 ? "turn" : "turns"}` : undefined,
    reported > 0 ? `reported for ${reported}` : undefined,
    priced > 0 ? `priced for ${priced}` : undefined,
    unknown > 0 ? `no figure for ${unknown}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? undefined : parts.join(", ");
}

function basisTiles(view: CostSeries): BasisTile[] {
  return BASES.map((basis): BasisTile => {
    const note = basis === "preferred" ? basisNote(view) : undefined;
    return {
      basis,
      basisText: basisText(basis),
      money: moneyViews(view.totals[basis], basis, view.currency),
      ...(note === undefined ? {} : { basisNote: note }),
    };
  });
}

function pointView(point: CostPoint, view: CostSeries): PointView {
  const cost = moneyViews(point.cost, view.basis, view.currency);
  return {
    period: point.period,
    label: view.bucket === "month" ? point.period : (formatDay(point.start) ?? point.period),
    start: point.start,
    end: point.end,
    turns: point.turns,
    unknown: cost.every((money) => !money.known),
    cost,
    cumulative: moneyViews(point.cumulative, view.basis, view.currency),
  };
}

function observedMarker(change: ObservedPriceChange): ObservedPriceChangeMarker {
  return {
    kind: "observed",
    inferred: true,
    label: "inferred",
    date: change.date,
    dateText: formatDay(change.date) ?? change.date,
    channel: change.channel,
    modelId: change.modelId,
    direction: change.direction,
    percentText: formatSignedPercent(change.percent, 0),
    weeksText: `${change.weeks.length} weeks in a row`,
  };
}

function markers(view: CostSeries): PriceMarker[] {
  const all = [...view.priceChanges.map(documentedPriceChange), ...view.observedChanges.map(observedMarker)];
  const bucketOf = (date: string) => view.points.find((point) => point.start <= date && date <= point.end)?.period;
  return all
    .map((marker): PriceMarker => {
      const period = bucketOf(marker.date);
      return period === undefined ? marker : { ...marker, period };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === "documented" ? -1 : 1));
}

function tokenTypeRow(row: ProjectCost["byTokenType"][number]): TokenTypeRow {
  return {
    model: row.model,
    vendorId: row.vendorId,
    uncachedInput: measureView(row.uncachedInput, formatTokens),
    cacheWrite: measureView(row.cacheWrite, formatTokens),
    cacheRead: measureView(row.cacheRead, formatTokens),
    reasoning: measureView(row.reasoning, formatTokens),
    output: measureView(row.output, formatTokens),
  };
}

function projectPart(cost: ProjectCost): ProjectPart {
  return {
    byRepository: cost.byRepository.map((row) => breakdownRow(row, cost)),
    byTokenType: cost.byTokenType.map(tokenTypeRow),
    topSessions: cost.topSessions.map((session): TopSessionView => {
      const startedText = formatDay(session.startedAt);
      return {
        providerId: session.providerId,
        sessionId: session.sessionId,
        model: session.model,
        turnsText: pluralize(session.turns, "turn"),
        ...(startedText === undefined ? {} : { startedText }),
        cost: moneyViews(session.cost, cost.basis, cost.currency),
        drillDown: { tool: "get_session_cost", arguments: { sessionId: session.sessionId, provider: session.providerId } },
        displayOnly: { title: session.title },
      };
    }),
  };
}

function isProject(cost: CostSeries | ProjectCost): cost is ProjectCost {
  return "project" in cost;
}

function title(cost: CostSeries | ProjectCost): string {
  if (isProject(cost)) return cost.project.name;
  // The folder name, as the tool returns it; the key can be a path, so it is never shown.
  return cost.series.length === 1 ? (cost.series[0]?.label ?? "Repository") : "Repository";
}

export function toCostSeriesViewModel(cost: CostSeries | ProjectCost): CostSeriesViewModel {
  const points = cost.points.map((point) => pointView(point, cost));
  const currencies = [...new Set(points.flatMap((point) => point.cost.flatMap((money) => (money.currency === null ? [] : [money.currency]))))];
  const viewModel: CostSeriesViewModel = {
    kind: isProject(cost) ? "project" : "repository",
    title: title(cost),
    bucket: cost.bucket,
    bucketText: BUCKET_TEXT[cost.bucket],
    basis: cost.basis,
    basisText: basisText(cost.basis),
    pricingText: pricingText(cost.pricing),
    sessionsText: pluralize(cost.sessions, "session"),
    turnsText: pluralize(cost.turns, "turn"),
    providerIssues: providerIssues(cost.providers),
    total: moneyViews(cost.total, cost.basis, cost.currency),
    basisTiles: basisTiles(cost),
    chart: { currencies, points },
    markers: markers(cost),
    byVendor: cost.byVendor.map((row) => vendorRow(row, cost)),
  };
  addShares(viewModel.byVendor);
  if (isProject(cost)) {
    viewModel.projectId = cost.project.id;
    viewModel.project = projectPart(cost);
  }
  const period = periodText(cost.since, cost.until);
  if (period !== undefined) viewModel.periodText = period;
  const conversion = conversionNoteFor(cost.currency, cost.conversion);
  if (conversion !== undefined) viewModel.conversionNote = conversion;
  if (cost.undatedTurns > 0) viewModel.undatedNote = `${pluralize(cost.undatedTurns, "turn")} ${cost.undatedTurns === 1 ? "has" : "have"} no date and ${cost.undatedTurns === 1 ? "is" : "are"} in no bucket`;
  return viewModel;
}
