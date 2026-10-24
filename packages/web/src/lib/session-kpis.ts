import type { Turn } from "@copilot-cost-analyzer/domain";
import { isFailedStatus } from "@copilot-cost-analyzer/domain";

// One KPI tile's text: the value, plus a coverage note when only some turns
// had the data. A value nothing supports reads "unknown", never 0
// (constraint 6).
export interface Kpi {
  value: string;
  note?: string;
}

export interface SessionKpis {
  aiCredits: Kpi;
  cacheRead: Kpi;
  turns: Kpi;
  toolCalls: Kpi;
}

function coverage(knownCount: number, total: number): string | undefined {
  return knownCount > 0 && knownCount < total ? `${knownCount} of ${total} turns known` : undefined;
}

function withNote(value: string, note: string | undefined): Kpi {
  return note ? { value, note } : { value };
}

// The narrow layout's 2×2 KPIs for one session (mock-up board 4).
export function sessionKpis(turns: Turn[]): SessionKpis {
  const costs = turns.flatMap((turn) => (turn.usage.costAiCredits.known ? [turn.usage.costAiCredits.value] : []));
  // A total is only a total when every turn's cost is in it.
  const aiCredits =
    turns.length > 0 && costs.length === turns.length
      ? { value: costs.reduce((sum, cost) => sum + cost, 0).toFixed(2) }
      : withNote("unknown", coverage(costs.length, turns.length));

  let reads = 0;
  let input = 0;
  let inputKnown = 0;
  for (const { usage } of turns) {
    if (!usage.uncachedInput.known || !usage.cacheRead.known) continue;
    inputKnown++;
    reads += usage.cacheRead.value;
    input += usage.uncachedInput.value + usage.cacheRead.value + (usage.cacheWrite.known ? usage.cacheWrite.value : 0);
  }
  const cacheRead =
    inputKnown > 0 && input > 0
      ? withNote(`${Math.round((reads / input) * 100)}%`, coverage(inputKnown, turns.length))
      : { value: "unknown" };

  const calls = turns.flatMap((turn) => turn.toolCalls);
  const failed = calls.filter((call) => call.outcome && isFailedStatus(call.outcome.status)).length;

  return {
    aiCredits,
    cacheRead,
    turns: { value: String(turns.length) },
    toolCalls: { value: failed > 0 ? `${calls.length} · ${failed} failed` : String(calls.length) },
  };
}
