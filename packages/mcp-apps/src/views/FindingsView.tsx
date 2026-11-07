// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { FindingKind, FindingSeverity } from "@agent-cost-analyzer/domain";
import type { ViewBrand } from "../brand/view-brand.js";
import type { AppHostPort, ToolResult } from "../host/app-host-port.js";
import { toFindingsViewModel } from "../view-models/findings.js";
import { FindingsFilters } from "./findings/FindingsFilters.js";
import { FindingsTable } from "./findings/FindingsTable.js";
import { parseFindingsResult } from "./findings/parse-findings-result.js";
import { SeverityTiles } from "./findings/SeverityTiles.js";
import { useFindingsQuery } from "./findings/use-findings-query.js";
import { ViewShell } from "./ViewShell.js";

// U3 (plan §4.3): the list_findings result with kind and severity filters.
// A filter change calls list_findings again through the port; the previous
// result stays visible while the call is in flight or after it fails.
// Finding text is display only: nothing here calls sendMessage, openLink or
// updateModelContext, and tool arguments carry filters, never logged text.
export function FindingsView({ brand, port, result }: { brand: ViewBrand; port: AppHostPort; result: ToolResult | undefined }) {
  const initial = result && !result.isError ? parseFindingsResult(result.structuredContent) : undefined;
  const query = useFindingsQuery(port, initial);

  if (result === undefined) {
    return (
      <ViewShell brand={brand} kicker="Findings" title="Findings">
        <p className="fv-status fv-muted" role="status">
          Loading findings
        </p>
      </ViewShell>
    );
  }
  if (!query.result) {
    return (
      <ViewShell brand={brand} kicker="Findings" title="Findings">
        <div className="fv-alert" role="alert">
          <span>
            <b>The tool returned an error.</b> Nothing is shown rather than a guess; ask again from the chat.
          </span>
        </div>
      </ViewShell>
    );
  }

  const model = toFindingsViewModel(query.result, query.filter);
  const loading = query.status.state === "loading";
  const failedFilter = query.status.state === "error" ? query.status.retry : undefined;
  const select = query.select;
  const { kind, minSeverity } = query.filter;
  return (
    <ViewShell brand={brand} kicker="Findings" title="Findings">
      <p className="fv-meta fv-muted">{model.summaryText}</p>
      <SeverityTiles tiles={model.severityTiles} />
      <FindingsFilters
        kindOptions={model.kindOptions}
        severityOptions={model.severityOptions}
        onKind={(next: FindingKind | "all") => select({ ...(minSeverity ? { minSeverity } : {}), ...(next === "all" ? {} : { kind: [next] }) })}
        onMinSeverity={(next: FindingSeverity | "all") => select({ ...(kind ? { kind } : {}), ...(next === "all" ? {} : { minSeverity: next }) })}
      />
      {loading && (
        <p className="fv-status fv-muted" role="status">
          Loading findings
        </p>
      )}
      {failedFilter && (
        <div className="fv-alert" role="alert">
          <span>
            <b>Couldn&apos;t load the findings.</b> The previous results are still shown.
          </span>
          <button type="button" onClick={() => select(failedFilter)}>
            Retry
          </button>
        </div>
      )}
      {model.emptyText ? (
        <p className="fv-empty fv-muted">{model.emptyText}</p>
      ) : (
        <>
          <FindingsTable rows={model.rows} busy={loading} />
          {model.shownText && <p className="fv-note fv-muted">{model.shownText}</p>}
        </>
      )}
    </ViewShell>
  );
}
