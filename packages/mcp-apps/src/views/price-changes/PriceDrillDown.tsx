// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { PriceChangeList } from "@agent-cost-analyzer/domain";
import { useMemo, useRef } from "react";
import type { ViewBrand } from "../../brand/view-brand.js";
import type { AppHostPort } from "../../host/app-host-port.js";
import type { PriceDrillDown as PriceDrillDownRequest } from "../../view-models/index.js";
import { BackButton } from "../cost-rollup/DrillDown.js";
import { PriceChangesView } from "../PriceChangesView.js";
import { ErrorBox } from "../SessionCostView.js";
import { ViewShell } from "../ViewShell.js";
import { useResource } from "../session-cost/tool-data.js";
import { parsePriceChanges } from "./parse-price-changes.js";

// U11 to U13 in place (plan §4.5): get_price_changes through the port, a tool
// the model can already call, for U11's whole period (the two periods and
// the gap between them) with no model argument: the tool filters by one
// model only, and the view needs the whole range to say "2 of 4 changes in
// the range". It then shows the models with the largest price effect. A tool
// call, never a chat message. U11 stays mounted in its parent, so Back
// refetches nothing; the parent returns focus to its button.

const COST_CHANGE = "Cost change";
const BACK_LABEL = "Back to cost change";
const KICKER = `${COST_CHANGE} › Price changes`;
const TITLE = "Price changes behind the cost change";

export function PriceDrillDown({ port, brand, request, onBack }: { port: AppHostPort; brand: ViewBrand; request: PriceDrillDownRequest; onBack: () => void }) {
  const failure = useRef<string | undefined>(undefined);
  const { since, until } = request;
  const { state, load } = useResource<PriceChangeList>(
    async () => {
      failure.current = undefined;
      const answer = await port.callTool("get_price_changes", { since, until });
      if (answer.isError) {
        failure.current = answer.errorText?.trim();
        return undefined;
      }
      return parsePriceChanges(answer.structuredContent);
    },
    true,
    `${since}:${until}`,
  );
  const result = useMemo(() => (state.status === "ready" ? { structuredContent: state.data } : undefined), [state]);
  const lead = <BackButton onBack={onBack} label={BACK_LABEL} trail={[COST_CHANGE, "Price changes"]} />;

  if (state.status === "ready") {
    return <PriceChangesView brand={brand} result={result} frame={{ kicker: KICKER, lead, models: request.models }} />;
  }
  return (
    <ViewShell brand={brand} kicker={KICKER} title={TITLE} lead={lead}>
      {state.status === "error" ? (
        <ErrorBox title="Couldn't load the price changes." onRetry={load}>
          {`${failure.current ? `The get_price_changes call returned an error: ${failure.current.slice(0, 500)}` : "The get_price_changes call failed."} Go back to the cost change, or retry.`}
        </ErrorBox>
      ) : (
        <p role="status" className="text-muted">
          Loading price changes…
        </p>
      )}
    </ViewShell>
  );
}
