// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SubagentSpend, Turn } from "@agent-cost-analyzer/domain";
import { sessionKpis } from "../lib/session-kpis.js";
import { sessionSubagentLine } from "../lib/subagent-runs.js";
import { aiCreditsToUsd, formatUsd } from "../lib/ai-credits-usd.js";
import { StatTile } from "./ui/StatTile.js";

// The narrow layout's 2×2 KPIs for the open session (mock-up board 4).
// Simulated sessions only: a measured session's credits are what was billed,
// the USD line is part of the simulation's labelling (D19).
function usdTitle(turns: Turn[]): string | undefined {
  if (!turns.some((turn) => turn.simulation)) return undefined;
  let total = 0;
  for (const turn of turns) {
    if (!turn.usage.costAiCredits.known) return undefined;
    total += turn.usage.costAiCredits.value;
  }
  return `≈ ${formatUsd(aiCreditsToUsd(total))}`;
}

export function SessionKpiTiles({ turns, subagentSpend }: { turns: Turn[]; subagentSpend?: SubagentSpend | undefined }) {
  const kpis = sessionKpis(turns);
  // Step 10.19 (D12): what the subagent runs added, under the total.
  const subagentLine = sessionSubagentLine(subagentSpend);
  const note = [kpis.aiCredits.note, subagentLine].filter(Boolean).join(" · ") || undefined;
  return (
    <div className="kpi-grid">
      <StatTile label="AI Credits" value={kpis.aiCredits.value} note={note} title={usdTitle(turns)} />
      <StatTile label="Cache read" {...kpis.cacheRead} />
      <StatTile label="Turns" {...kpis.turns} />
      <StatTile label="Tool calls" {...kpis.toolCalls} />
    </div>
  );
}
