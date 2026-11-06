import type { ProjectsFile, ProjectsState, RepositoryList, StatementAnswer } from "@agent-cost-analyzer/domain";
import { getApiTransport } from "./current-transport.js";

// Phase 15 step 15.11: the Billing tab (GET /api/statements, the issue
// POST) and the Projects editor (GET/PUT /api/projects, GET /api/repositories).

export interface StatementQuery {
  projectId: string;
  period: string; // "YYYY-MM" or "YYYY-MM-DD..YYYY-MM-DD"
  provider?: string;
}

export function fetchStatement(query: StatementQuery, signal?: AbortSignal): Promise<StatementAnswer> {
  return getApiTransport().call<StatementAnswer>("getStatement", query, signal);
}

export function issueStatement(projectId: string, period: string): Promise<StatementAnswer> {
  return getApiTransport().call<StatementAnswer>("issueStatement", { projectId, period });
}

export function fetchProjects(signal?: AbortSignal): Promise<ProjectsState> {
  return getApiTransport().call<ProjectsState>("getProjects", undefined, signal);
}

export function saveProjects(file: ProjectsFile): Promise<ProjectsState> {
  return getApiTransport().call<ProjectsState>("saveProjects", { file });
}

export function fetchRepositoryList(signal?: AbortSignal): Promise<RepositoryList> {
  return getApiTransport().call<RepositoryList>("getRepositoryList", undefined, signal);
}
