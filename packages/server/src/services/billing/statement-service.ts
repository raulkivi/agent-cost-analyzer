// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import {
  addDays,
  diffStatements,
  parseStatementPeriod,
  periodHasEnded,
  type Project,
  type ProjectsFile,
  type ProjectsState,
  type StatementAnswer,
  type StatementPeriod,
} from "@agent-cost-analyzer/domain";
import type { CostCubeSource } from "../cost-analysis/cost-analysis-service.js";
import { buildStatement } from "./statement-builder.js";
import type { StatementStore } from "./statement-store.js";

// Phase 15 step 15.11 (docs/plans/cost-by-repository-and-project.md §8.5,
// D6, D15): statements for GET /api/statements, its issue endpoint and MCP
// get_statement. The draft is built on demand from the cost cube (priced as
// of use); an issued statement is read from the store and never rebuilt,
// and the re-run beside it gives the exact diff. Only an ended period can be
// issued. Months are calendar months in the machine's time zone (D6),
// written into the statement.

export class UnknownStatementPeriodError extends Error {
  constructor(period: string) {
    super(`"${period}" is not a statement period: use a month as YYYY-MM or a range as YYYY-MM-DD..YYYY-MM-DD.`);
  }
}

export class PeriodNotEndedError extends Error {}
export class AlreadyIssuedError extends Error {}
export class UnknownStatementProjectError extends Error {
  constructor(projectId: string) {
    super(`Unknown project id "${projectId}".`);
  }
}

export interface StatementServiceDeps {
  cubes: CostCubeSource;
  store: StatementStore;
  projects: { load(): Pick<ProjectsState, "file"> };
  // A short hash of the price book's versions, for provenance and the diff.
  priceBookHash: () => string;
  appVersion: string;
  timeZone: string;
  now?: () => Date;
}

export interface StatementRequest {
  projectId: string;
  period: string;
  providerId?: string;
  limit?: number;
}

export const shortHash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 12);

// The price book as provenance: a hash of its versions in id order.
export function priceBookHashOf(versions: readonly { id: string }[]): string {
  return shortHash(JSON.stringify([...versions].sort((a, b) => a.id.localeCompare(b.id))));
}

// The narrow interface ApiService and the MCP tools use (ISP).
export interface StatementQueries {
  get(request: StatementRequest): Promise<StatementAnswer | null>;
  issue(request: StatementRequest): Promise<StatementAnswer>;
}

export class StatementService implements StatementQueries {
  private readonly now: () => Date;

  constructor(private readonly deps: StatementServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async get(request: StatementRequest): Promise<StatementAnswer | null> {
    const period = this.period(request.period);
    const file = this.deps.projects.load().file;
    const project = file.projects.find((candidate) => candidate.id === request.projectId);
    if (!project) return null;
    const draft = await this.draft(request, period, project, file);
    const issuedPeriods = this.deps.store.list(project.id);
    const issued = this.deps.store.read(project.id, period.key);
    if (issued) {
      return {
        statement: issued,
        rerun: draft,
        diff: diffStatements(issued, draft),
        canIssue: { ok: false, reason: `Already issued on ${issued.issuedAt}; a frozen statement is never changed.` },
        issuedPeriods,
      };
    }
    return { statement: draft, canIssue: this.canIssue(period), issuedPeriods };
  }

  async issue(request: StatementRequest): Promise<StatementAnswer> {
    const answer = await this.get(request);
    if (answer === null) throw new UnknownStatementProjectError(request.projectId);
    if (answer.statement.status === "issued") throw new AlreadyIssuedError(answer.canIssue.reason);
    if (!answer.canIssue.ok) throw new PeriodNotEndedError(answer.canIssue.reason);
    const issued = { ...answer.statement, status: "issued" as const, issuedAt: this.now().toISOString() };
    this.deps.store.write(issued);
    return { statement: issued, rerun: answer.statement, diff: diffStatements(issued, answer.statement), canIssue: { ok: false, reason: `Already issued on ${issued.issuedAt}; a frozen statement is never changed.` }, issuedPeriods: this.deps.store.list(issued.project.id) };
  }

  private period(text: string): StatementPeriod {
    const period = parseStatementPeriod(text, this.deps.timeZone);
    if (!period) throw new UnknownStatementPeriodError(text);
    return period;
  }

  private canIssue(period: StatementPeriod): StatementAnswer["canIssue"] {
    if (periodHasEnded(period, this.now())) return { ok: true };
    return { ok: false, reason: `${period.label} hasn't ended yet in ${period.timeZone}; it can be issued from ${addDays(period.until, 1)}.` };
  }

  private async draft(request: StatementRequest, period: StatementPeriod, project: Project, file: ProjectsFile) {
    // A day either side covers any time zone; turns are then placed by their own day.
    const cube = await this.deps.cubes.getCube(
      {
        ...(request.providerId !== undefined ? { providerId: request.providerId } : {}),
        ...(request.limit !== undefined ? { limit: request.limit } : {}),
        since: addDays(period.since, -1),
        until: addDays(period.until, 1),
      },
      "as-of-use",
    );
    return buildStatement(cube, {
      project,
      period,
      generatedAt: this.now().toISOString(),
      appVersion: this.deps.appVersion,
      priceBookHash: this.deps.priceBookHash(),
      projectsFileHash: shortHash(JSON.stringify(file)),
    });
  }
}
