// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";
import { addDays, redactRepositoryKey, type CostEstimate } from "@agent-cost-analyzer/domain";
import type { CostCubeSource, ProjectDirectory } from "../cost-analysis/cost-analysis-service.js";
import { buildCostEstimate } from "./estimate-builder.js";

// Phase 15 step 15.12 (docs/plans/cost-by-repository-and-project.md §8.6,
// §10.1.1): estimates for GET /api/estimates and MCP estimate_cost. One cube
// per request, priced at today's prices, over the sessions started in the
// history window; the pure buildCostEstimate does the rest.

const wholeFromOne = z.coerce.number().int().min(1).max(10_000);

export const estimateRequestSchema = z
  .object({
    projectId: z.string().min(1).optional(),
    repository: z.string().min(1).max(2048).optional(),
    activeDays: wholeFromOne.optional(),
    sessions: wholeFromOne.optional(),
    historyWeeks: z.coerce.number().pipe(z.union([z.literal(4), z.literal(12)])).default(12),
    provider: z.string().min(1).optional(),
  })
  .refine((value) => (value.projectId === undefined) !== (value.repository === undefined), { message: "give a projectId or a repository, not both", path: ["projectId"] })
  .refine((value) => (value.activeDays === undefined) !== (value.sessions === undefined), { message: "give activeDays or sessions, not both", path: ["activeDays"] });

export type EstimateRequest = ({ projectId: string } | { repository: string }) & {
  unit: CostEstimate["unit"];
  planned: number;
  weeks: 4 | 12;
  providerId?: string;
};

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseEstimateQuery(query: Readonly<Record<string, unknown>>): ParseResult<EstimateRequest> {
  const parsed = estimateRequestSchema.safeParse(query);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((issue) => `${issue.path.join(".") || "query"}: ${issue.message}`).join("; ") };
  const value = parsed.data;
  return {
    ok: true,
    value: {
      ...(value.projectId !== undefined ? { projectId: value.projectId } : { repository: value.repository! }),
      unit: value.activeDays !== undefined ? "activeDays" : "sessions",
      planned: value.activeDays ?? value.sessions!,
      weeks: value.historyWeeks as 4 | 12,
      ...(value.provider !== undefined ? { providerId: value.provider } : {}),
    },
  };
}

export interface EstimateServiceDeps {
  cubes: CostCubeSource;
  projects: ProjectDirectory;
  now?: () => Date;
}

// The narrow interface ApiService and the MCP tool use (ISP).
export interface EstimateQueries {
  estimate(request: EstimateRequest): Promise<CostEstimate | null>;
}

export class EstimateService implements EstimateQueries {
  private readonly now: () => Date;

  constructor(private readonly deps: EstimateServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async estimate(request: EstimateRequest): Promise<CostEstimate | null> {
    const target =
      "projectId" in request
        ? (() => {
            const name = this.deps.projects.projectName(request.projectId);
            return name === undefined ? null : { groupBy: "project" as const, id: request.projectId, name };
          })()
        : { groupBy: "repository" as const, id: request.repository, name: redactRepositoryKey(request.repository) };
    if (target === null) return null;
    const now = this.now();
    const until = now.toISOString().slice(0, 10);
    const cube = await this.deps.cubes.getCube(
      { ...(request.providerId !== undefined ? { providerId: request.providerId } : {}), since: addDays(until, -(request.weeks * 7 - 1)), until },
      "today",
    );
    const estimate = buildCostEstimate(cube, { target, unit: request.unit, planned: request.planned, weeks: request.weeks, now });
    return { ...estimate, target: { ...target, id: target.groupBy === "repository" ? redactRepositoryKey(target.id) : target.id } };
  }
}
