// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CostSeries, ProjectCost } from "@agent-cost-analyzer/domain";
import { useMemo, useRef } from "react";
import type { ViewBrand } from "../../brand/view-brand.js";
import type { AppHostPort, ToolResult } from "../../host/app-host-port.js";
import type { ClipboardPort } from "../../host/clipboard-port.js";
import { CostOverTimeView } from "../CostOverTimeView.js";
import { ErrorBox } from "../SessionCostView.js";
import { ViewShell } from "../ViewShell.js";
import { explainError } from "../cost-over-time/explain-error.js";
import { parseCostSeries } from "../cost-over-time/parse-cost-series.js";
import { BackButton } from "../cost-rollup/DrillDown.js";
import { useResource } from "../session-cost/tool-data.js";
import type { OpenRow } from "./ComparisonTable.js";
import "./cost-compare.css";

// U10 to U9 in place (plan §4.5): get_repository_cost or get_project_cost
// through the port, the tools the model can already call, with exactly the
// row's drillDown arguments. The comparison stays in the parent, so going
// back refetches nothing. The trail ("Cost comparison / Provider platform")
// names the path; U9 adds its own Back and the session below it.

const COMPARISON = "Cost comparison";
const BACK_LABEL = "Back to comparison";

// Literal tool names and reviewed argument names, so the static
// no-forwarding scan (test/security) reads every host call.
function openRow(port: AppHostPort, drill: OpenRow["drillDown"]): Promise<ToolResult> {
  const args = drill.arguments;
  if ("repository" in args) {
    return port.callTool("get_repository_cost", { repository: args.repository, since: args.since, until: args.until, basis: args.basis, pricing: args.pricing, currency: args.currency });
  }
  return port.callTool("get_project_cost", { projectId: args.projectId, since: args.since, until: args.until, basis: args.basis, pricing: args.pricing, currency: args.currency });
}

export function CompareDrillDown({ port, brand, clipboard, row, onBack }: { port: AppHostPort; brand: ViewBrand; clipboard: ClipboardPort | undefined; row: OpenRow; onBack: () => void }) {
  // Why the last call failed: the tool's own text, shown as plain text.
  const failure = useRef<string | undefined>(undefined);
  const { state, load } = useResource<CostSeries | ProjectCost>(
    async () => {
      failure.current = undefined;
      const answer = await openRow(port, row.drillDown);
      if (answer.isError) {
        failure.current = answer.errorText;
        return undefined;
      }
      return parseCostSeries(answer.structuredContent);
    },
    true,
    row.key,
  );
  const result = useMemo(() => (state.status === "ready" ? { structuredContent: state.data } : undefined), [state]);
  const trail = [COMPARISON, row.label];
  const kind = row.drillDown.tool === "get_project_cost" ? "Project cost" : "Repository cost";
  const lead = (takeFocus: boolean) => <BackButton onBack={onBack} label={BACK_LABEL} trail={trail} takeFocus={takeFocus} />;

  if (state.status === "ready") {
    return <CostOverTimeView port={port} brand={brand} clipboard={clipboard} result={result} frame={{ kicker: COMPARISON, lead, trail }} />;
  }
  if (state.status === "error") {
    const explained = explainError(failure.current);
    if (explained.kind === "no-projects") {
      return (
        <ViewShell brand={brand} kicker={`${COMPARISON} › ${kind}`} title="No projects here" lead={lead(true)}>
          <div className="cc-state">
            <p>{explained.reason}</p>
            <p className="text-muted">
              The tool answered <code>{explained.answer}</code>. Cost by repository works as usual.
            </p>
          </div>
        </ViewShell>
      );
    }
    const cause = explained.text === undefined ? `The ${row.drillDown.tool} call failed.` : `${row.drillDown.tool} returned an error: ${explained.text}`;
    return (
      <ViewShell brand={brand} kicker={`${COMPARISON} › ${kind}`} title={row.label} lead={lead(true)}>
        <ErrorBox title={`Couldn't open ${row.label}.`} onRetry={load}>
          {`${cause} Go back to the comparison, or retry.`}
        </ErrorBox>
      </ViewShell>
    );
  }
  return (
    <ViewShell brand={brand} kicker={`${COMPARISON} › ${kind}`} title={row.label} lead={lead(true)}>
      <p role="status" className="text-muted">
        {`Loading ${row.label}…`}
      </p>
    </ViewShell>
  );
}
