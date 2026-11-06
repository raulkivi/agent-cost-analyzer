import { redactRepositoryKey, type CostCompareGroupBy } from "@agent-cost-analyzer/domain";

// Phase 15 step 15.9 (plan §11.1, §11.3): the Dashboard's list-box
// selection as a request to GET /api/cost/*. Those endpoints filter by a
// project or repository grouping and one provider, so those selections
// apply; any other selected field is listed as `ignored`, and the tab says
// so, rather than showing figures that only look filtered.

type Selections = Readonly<Record<string, readonly string[]>>;

// The list boxes' values for "no project" and "no repository", which no
// API id can name.
export interface ScopePlaceholders {
  project: string;
  repository: string;
}

export interface SeriesScope {
  groupBy: "project" | "repository";
  ids?: string[];
  // Lines to keep (API keys; null is the No project / Unattributed line),
  // when the selection includes a placeholder: the request then asks for
  // every line and the tab keeps these.
  keep?: (string | null)[];
  providerId?: string;
  ignored: string[];
}

export interface CompareScope {
  ids: string[];
  providerId?: string;
  ignored: string[];
}

export const MAX_COMPARED = 20;

const selected = (selections: Selections, field: string): readonly string[] => selections[field] ?? [];

function providerAndIgnored(selections: Selections, applied: readonly string[]): { providerId?: string; ignored: string[] } {
  const providers = selected(selections, "provider");
  const providerId = providers.length === 1 ? providers[0] : undefined;
  const ignored = Object.entries(selections)
    .filter(([field, values]) => values.length > 0 && !applied.includes(field) && !(field === "provider" && providerId !== undefined))
    .map(([field]) => field);
  return { ...(providerId !== undefined ? { providerId } : {}), ignored };
}

export function seriesScope(selections: Selections, placeholders: ScopePlaceholders): SeriesScope {
  const projects = selected(selections, "project");
  const repositories = selected(selections, "repository");
  const groupBy = projects.length > 0 || repositories.length === 0 ? "project" : "repository";
  const values = groupBy === "project" ? projects : repositories;
  const placeholder = placeholders[groupBy];
  const rest = providerAndIgnored(selections, [groupBy]);
  if (values.length === 0) return { groupBy, ...rest };
  if (values.includes(placeholder)) {
    return { groupBy, keep: values.map((value) => (value === placeholder ? null : value)), ...rest };
  }
  return { groupBy, ids: [...values], ...rest };
}

// Whether a line of the response belongs to the scope. Repository keys come
// back redacted (local: and path: keys as their folder, §10.1.5).
export function keepLine(scope: Pick<SeriesScope, "groupBy" | "keep">, key: string | null): boolean {
  if (!scope.keep) return true;
  const wanted = scope.groupBy === "repository" ? scope.keep.map((value) => (value === null ? null : redactRepositoryKey(value))) : scope.keep;
  return wanted.includes(key);
}

// `possible`: the grouping field's values still possible under the whole
// selection, in their fixed order. The selected values when there are two
// or more; otherwise everything possible, so the tab is useful at once.
export function compareScope(
  groupBy: CostCompareGroupBy,
  selections: Selections,
  possible: readonly string[],
  placeholders: ScopePlaceholders,
): CompareScope {
  const placeholder = placeholders[groupBy];
  const chosen = selected(selections, groupBy).filter((value) => value !== placeholder);
  const ids = (chosen.length >= 2 ? chosen : possible.filter((value) => value !== placeholder)).slice(0, MAX_COMPARED);
  return { ids: [...ids], ...providerAndIgnored(selections, ["project", "repository"]) };
}
