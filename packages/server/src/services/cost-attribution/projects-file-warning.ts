// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ConfigWarning, ProjectsState } from "@agent-cost-analyzer/domain";

// Phase 15 step 15.3: a projects file with problems becomes an optional
// config warning (the app works without projects). A file that failed its
// schema is ignored until fixed; one with only cross-entry problems (a tie,
// an alias chain) is still used, file order deciding ties.
const MAX_LISTED_PROBLEMS = 3;

export function buildProjectsFileWarning(state: ProjectsState): ConfigWarning | null {
  if (state.status !== "invalid") {
    return null;
  }
  const count = state.problems.length;
  const ignored = state.file.projects.length === 0 && Object.keys(state.file.aliases).length === 0;
  const listed = state.problems.slice(0, MAX_LISTED_PROBLEMS).map((problem) => (problem.path ? `${problem.path}: ${problem.message}` : problem.message));
  const more = count > MAX_LISTED_PROBLEMS ? [`… and ${count - MAX_LISTED_PROBLEMS} more.`] : [];
  return {
    code: "projects-file-invalid",
    severity: "optional",
    settingId: state.location,
    currentValue: count,
    recommendedValue: 0,
    message: ignored
      ? `The projects file has ${count} problem${count === 1 ? "" : "s"}, so projects are ignored until it is fixed; cost by repository still works.`
      : `The projects file has ${count} problem${count === 1 ? "" : "s"}; it is still used, with file order deciding any tie.`,
    helpSteps: [...listed, ...more, `Fix ${state.location} (or use the projects editor), then reload.`],
  };
}
