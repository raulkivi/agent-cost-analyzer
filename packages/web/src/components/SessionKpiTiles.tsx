import type { Turn } from "@agent-cost-analyzer/domain";
import { sessionKpis } from "../lib/session-kpis.js";
import { StatTile } from "./ui/StatTile.js";

// The narrow layout's 2×2 KPIs for the open session (mock-up board 4).
export function SessionKpiTiles({ turns }: { turns: Turn[] }) {
  const kpis = sessionKpis(turns);
  return (
    <div className="kpi-grid">
      <StatTile label="AI Credits" {...kpis.aiCredits} />
      <StatTile label="Cache read" {...kpis.cacheRead} />
      <StatTile label="Turns" {...kpis.turns} />
      <StatTile label="Tool calls" {...kpis.toolCalls} />
    </div>
  );
}
