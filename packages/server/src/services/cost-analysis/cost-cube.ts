import type { InsightProviderStatus, InsightsDataset, InsightTurnRow, TurnCostFigures } from "@agent-cost-analyzer/domain";
import { costOf } from "../cost/cost-aggregation.js";

// Phase 15 step 15.7 (docs/plans/cost-by-repository-and-project.md §8, §9):
// the flat cost cube every cost analysis reads, built once per request. One
// row per dated turn of the Insights dataset (step 15.4's attribution, step
// 15.6's cost figures), joined to its session's provider, title and start.
// The time series, compare and project builders are pure functions over it.

export type CostCubeRow = Pick<
  InsightTurnRow,
  | "repositoryKey"
  | "unattributedReason"
  | "projectId"
  | "vendorId"
  | "vendorUnknownReason"
  | "channel"
  | "channelUnknownReason"
  | "model"
  | "uncachedInput"
  | "cacheWrite"
  | "cacheRead"
  | "reasoning"
  | "output"
  | "aiCredits"
  | "estimated"
> & {
  turnKey: string;
  sessionKey: string;
  providerId: string;
  sessionId: string;
  sessionTitle: string;
  sessionModel: string;
  sessionStartedAt?: string;
  date: string; // YYYY-MM-DD (UTC): the turn's own time, else its session's
  at?: string; // step 15.11: the same instant, ISO (statements bill in their time zone, D6)
  cost: TurnCostFigures;
};

export interface CostCube {
  generatedAt: string;
  providers: InsightProviderStatus[];
  rows: CostCubeRow[];
  // Turns with neither a time of their own nor a session start: in no bucket.
  undatedTurns: number;
  projectName(id: string): string;
  vendorLabel(id: string): string;
}

export function buildCostCube(dataset: InsightsDataset): CostCube {
  const sessions = new Map(dataset.sessions.map((session) => [session.key, session]));
  const projectNames = new Map((dataset.projects ?? []).map((project) => [project.id, project.name]));
  const vendorLabels = new Map((dataset.vendors ?? []).map((vendor) => [vendor.id, vendor.label]));
  const rows: CostCubeRow[] = [];
  let undatedTurns = 0;
  for (const turn of dataset.turns) {
    const session = sessions.get(turn.sessionKey);
    // The dataset's turn date is already the turn's own time, else its session's.
    const date = turn.date;
    if (session === undefined || date === undefined) {
      undatedTurns += 1;
      continue;
    }
    rows.push({
      turnKey: turn.key,
      sessionKey: turn.sessionKey,
      providerId: session.providerId,
      sessionId: session.sessionId,
      sessionTitle: session.title,
      sessionModel: session.model,
      ...(session.startedAt !== undefined ? { sessionStartedAt: session.startedAt } : {}),
      date,
      ...(turn.at !== undefined ? { at: turn.at } : {}),
      model: turn.model,
      repositoryKey: turn.repositoryKey,
      ...(turn.unattributedReason !== undefined ? { unattributedReason: turn.unattributedReason } : {}),
      projectId: turn.projectId,
      vendorId: turn.vendorId,
      ...(turn.vendorUnknownReason !== undefined ? { vendorUnknownReason: turn.vendorUnknownReason } : {}),
      channel: turn.channel,
      ...(turn.channelUnknownReason !== undefined ? { channelUnknownReason: turn.channelUnknownReason } : {}),
      uncachedInput: turn.uncachedInput,
      cacheWrite: turn.cacheWrite,
      cacheRead: turn.cacheRead,
      reasoning: turn.reasoning,
      output: turn.output,
      aiCredits: turn.aiCredits,
      estimated: turn.estimated,
      cost: costOf(turn),
    });
  }
  return {
    generatedAt: dataset.generatedAt,
    providers: dataset.providers,
    rows,
    undatedTurns,
    projectName: (id) => projectNames.get(id) ?? id,
    vendorLabel: (id) => vendorLabels.get(id) ?? id,
  };
}
