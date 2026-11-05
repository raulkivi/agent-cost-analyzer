import {
  findPriceVersionConflicts,
  type PriceBookEntry,
  type PriceBookListing,
  type PriceLookup,
} from "@agent-cost-analyzer/domain";
import type { PriceBookSource } from "./price-book-source.js";

// Phase 15 step 15.5 (docs/plans/cost-by-repository-and-project.md §6.2):
// which price version applies to a turn on a channel and model at a time.
// Ranges are [effectiveFrom, effectiveTo), dates in UTC. A contract version
// in the turn's scope beats the list price: repository scope first, then
// project scope, then an unscoped contract. Anything else is unknown with a
// reason, never a zero price (architecture.md constraint 6).

// The project and repository a turn is attributed to (step 15.4).
export interface PriceScope {
  projectId?: string;
  repositoryKey?: string;
}

export interface PriceBookQuery {
  channel?: string;
  model?: string;
  // ISO date or timestamp: keep only the versions in force then.
  at?: string;
}

// The narrow read interface the MCP tool and the HTTP route use.
export interface PriceBookReader {
  list(query: PriceBookQuery): PriceBookListing;
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;
const HAS_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/;

function parseTime(at: string): number | undefined {
  if (!ISO_TIME.test(at)) return undefined;
  // A bare date is UTC midnight, like effectiveFrom; a timestamp without an
  // offset is read as UTC too, so the answer doesn't depend on the machine.
  const normalised = at.length === 10 ? `${at}T00:00:00Z` : HAS_OFFSET.test(at) ? at : `${at}Z`;
  const time = Date.parse(normalised);
  return Number.isNaN(time) ? undefined : time;
}

const dateStart = (date: string): number => Date.parse(`${date}T00:00:00Z`);

function inForce(version: PriceBookEntry, time: number): boolean {
  return dateStart(version.effectiveFrom) <= time && (version.effectiveTo === undefined || time < dateStart(version.effectiveTo));
}

const isList = (version: PriceBookEntry): boolean => version.kind !== "contract";

// Higher wins; undefined = the contract doesn't apply to this scope.
function contractRank(version: PriceBookEntry, scope: PriceScope): number | undefined {
  if (version.scope === undefined) return 1;
  if ("repository" in version.scope) return version.scope.repository === scope.repositoryKey ? 3 : undefined;
  return version.scope.projectId === scope.projectId ? 2 : undefined;
}

function compareEntries(a: PriceBookEntry, b: PriceBookEntry): number {
  return (
    a.channel.localeCompare(b.channel) ||
    a.modelId.localeCompare(b.modelId) ||
    a.effectiveFrom.localeCompare(b.effectiveFrom) ||
    (a.origin === b.origin ? 0 : a.origin === "bundled" ? -1 : 1) ||
    a.id.localeCompare(b.id)
  );
}

function pairsOf(versions: PriceBookEntry[]): [string, string][] {
  const seen = new Map<string, [string, string]>();
  for (const version of versions) seen.set(JSON.stringify([version.channel, version.modelId]), [version.channel, version.modelId]);
  return [...seen.values()];
}

export class PriceBook implements PriceBookReader {
  constructor(private readonly source: PriceBookSource) {}

  priceFor(channel: string, modelId: string, at: string, scope: PriceScope = {}): PriceLookup {
    const time = parseTime(at);
    if (time === undefined) {
      return { known: false, reason: `cannot price at ${JSON.stringify(at)}: not an ISO date or timestamp` };
    }
    const onChannel = this.source.load().versions.filter((version) => version.channel === channel);
    if (onChannel.length === 0) return { known: false, reason: `no price book for channel ${channel}` };
    const candidates = onChannel.filter((version) => version.modelId === modelId);
    if (candidates.length === 0) return { known: false, reason: `no price for ${modelId} on ${channel}` };

    let best: { version: PriceBookEntry; rank: number } | undefined;
    for (const version of candidates) {
      if (!inForce(version, time)) continue;
      const rank = isList(version) ? 0 : contractRank(version, scope);
      if (rank !== undefined && (best === undefined || rank > best.rank)) best = { version, rank };
    }
    if (best !== undefined) return { known: true, version: best.version };
    return { known: false, reason: reasonForNoListPrice(candidates.filter(isList), channel, modelId, time) };
  }

  // The price "now" for Phase 13's simulator (plan §6.1): the latest list
  // or promo version, whatever its end date.
  newestVersion(channel: string, modelId: string): PriceBookEntry | undefined {
    return this.source
      .load()
      .versions.filter((version) => version.channel === channel && version.modelId === modelId && isList(version))
      .sort(compareEntries)
      .at(-1);
  }

  list(query: PriceBookQuery): PriceBookListing {
    const data = this.source.load();
    const all = [...data.versions].sort(compareEntries);
    const channels = [...new Set(all.map((version) => version.channel))].sort();
    const matching = all.filter(
      (version) =>
        (query.channel === undefined || version.channel === query.channel) && (query.model === undefined || version.modelId === query.model),
    );
    const unknown: PriceBookListing["unknown"] = [];
    if (query.channel !== undefined && !channels.includes(query.channel)) {
      unknown.push({ channel: query.channel, modelId: query.model ?? "*", reason: `no price book for channel ${query.channel}` });
    } else if (matching.length === 0 && query.model !== undefined) {
      unknown.push({
        channel: query.channel ?? "*",
        modelId: query.model,
        reason: `no price for ${query.model} on ${query.channel ?? "any channel"}`,
      });
    }

    let versions = matching;
    if (query.at !== undefined) {
      const at = query.at;
      const time = parseTime(at);
      versions = time === undefined ? [] : matching.filter((version) => inForce(version, time));
      for (const [channel, modelId] of pairsOf(matching)) {
        if (!versions.some((version) => version.channel === channel && version.modelId === modelId)) {
          const lookup = this.priceFor(channel, modelId, at);
          // Known here means only a scoped contract would apply; still none in force for every turn.
          unknown.push({ channel, modelId, reason: lookup.known ? `no price for ${modelId} on ${channel}` : lookup.reason });
        }
      }
    }

    const cited = new Set(versions.flatMap((version) => version.sourceIds));
    return {
      channels,
      versions,
      sources: data.sources.filter((source) => cited.has(source.id)),
      gaps: findPriceVersionConflicts(matching.filter(isList)).gaps,
      unknown,
      problems: data.problems,
    };
  }
}

function reasonForNoListPrice(list: PriceBookEntry[], channel: string, modelId: string, time: number): string {
  const subject = `no price for ${modelId} on ${channel}`;
  if (list.length === 0) return `${subject}: its contract prices don't apply to this turn`;
  const sorted = [...list].sort(compareEntries);
  const previous = sorted.filter((version) => dateStart(version.effectiveFrom) <= time).at(-1);
  const next = sorted.find((version) => dateStart(version.effectiveFrom) > time);
  if (previous === undefined) return `${subject} before ${sorted[0]!.effectiveFrom}`;
  if (next === undefined) return `${subject} from ${previous.effectiveTo}`;
  return `${subject} between ${previous.effectiveTo} and ${next.effectiveFrom}`;
}
