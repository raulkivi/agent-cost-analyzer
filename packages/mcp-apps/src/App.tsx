// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useEffect, useState } from "react";
import type { AppHostPort, HostContext, ToolResult } from "./host/app-host-port.js";
import type { ViewBrand } from "./brand/view-brand.js";
import type { ClipboardPort } from "./host/clipboard-port.js";
import { selectView } from "./router/select-view.js";
import { SessionCostView } from "./views/SessionCostView.js";
import { CostRollupView } from "./views/CostRollupView.js";
import { FindingsView } from "./views/FindingsView.js";
import { CostOverTimeView } from "./views/CostOverTimeView.js";
import { CostChangeView } from "./views/CostChangeView.js";
import { CostCompareView } from "./views/CostCompareView.js";
import { PriceChangesView } from "./views/PriceChangesView.js";
import { NoViewState } from "./views/NoViewState.js";

// Depends on the port only (DIP): the host, the brand and the data come in.
export function App({ port, brand, clipboard }: { port: AppHostPort; brand: ViewBrand; clipboard?: ClipboardPort | undefined }) {
  const [context, setContext] = useState<HostContext | undefined>();
  const [result, setResult] = useState<ToolResult | undefined>();

  useEffect(() => {
    const stops = [port.onHostContext(setContext), port.onToolResult(setResult)];
    void port.connect().catch(() => undefined);
    return () => stops.forEach((stop) => stop());
  }, [port]);

  // Nothing to show until the host has said which tool this is, or sent a result.
  if (!context && !result) return null;

  const selection = selectView(context, result?.structuredContent);
  switch (selection.view) {
    case "session-cost":
      return <SessionCostView port={port} brand={brand} clipboard={clipboard} result={result} />;
    case "cost-rollup":
      return <CostRollupView port={port} brand={brand} clipboard={clipboard} result={result} />;
    case "findings":
      return <FindingsView brand={brand} port={port} result={result} />;
    case "cost-over-time":
      return <CostOverTimeView port={port} brand={brand} clipboard={clipboard} result={result} />;
    case "cost-change":
      return <CostChangeView port={port} brand={brand} result={result} />;
    case "cost-compare":
      return <CostCompareView port={port} brand={brand} clipboard={clipboard} result={result} />;
    case "price-changes":
      return <PriceChangesView port={port} brand={brand} result={result} />;
    default:
      return <NoViewState brand={brand} />;
  }
}
