// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { emptyProjectsFile, type ProjectsFile, type RepositoryList } from "@agent-cost-analyzer/domain";
import {
  addCaptureRule,
  addMember,
  addProject,
  assignRepository,
  renameProject,
  branchesText,
  problemsOf,
  removeMember,
  unassignedRepositories,
  updateMember,
  updateProject,
} from "./editor-model.js";

// Phase 15 step 15.11 (plan §7, §11.5; board 5): the Projects editor's edits
// as pure functions over the projects file, and its validation (the
// domain's schema and cross-entry checks), keyed by where each problem is.

const repositoryList = (keys: { key: string; projectIds?: string[]; sessionCount?: number; lastUsedAt?: string }[]): RepositoryList => ({
  repositories: keys.map((entry) => ({
    key: entry.key,
    source: "git-remote",
    sessionCount: entry.sessionCount ?? 1,
    turnCount: 1,
    aiCredits: { value: null, knownSessions: 0, sessions: 1 },
    providerIds: ["vscode"],
    projectIds: entry.projectIds ?? [],
    ...(entry.lastUsedAt ? { lastUsedAt: entry.lastUsedAt } : {}),
  })),
  unattributed: [],
  providers: [],
});

describe("editor model", () => {
  it("adds a project with an id made from its name, kept unique", () => {
    let file = addProject(emptyProjectsFile(), "Customer Portal!");
    file = addProject(file, "Customer portal");
    expect(file.projects.map((project) => [project.id, project.name])).toEqual([
      ["customer-portal", "Customer Portal!"],
      ["customer-portal-2", "Customer portal"],
    ]);
    expect(file.projects[0]!.members).toEqual([]);
  });

  it("assigns a repository to a project as a whole-repository member", () => {
    const file = assignRepository(addProject(emptyProjectsFile(), "Portal"), "github.com/acme/web", "portal");
    expect(file.projects[0]!.members).toEqual([{ repository: "github.com/acme/web" }]);
  });

  it("lists repositories without a project first, most used first", () => {
    const list = repositoryList([
      { key: "github.com/acme/a", projectIds: ["portal"] },
      { key: "github.com/acme/b", sessionCount: 2 },
      { key: "github.com/acme/c", sessionCount: 9 },
    ]);
    // The editor's own (possibly unsaved) file decides what is claimed.
    const saved = assignRepository(addProject(emptyProjectsFile(), "Portal"), "github.com/acme/a", "portal");
    expect(unassignedRepositories(list, saved).map((entry) => entry.key)).toEqual(["github.com/acme/c", "github.com/acme/b"]);
    const file = assignRepository(saved, "github.com/acme/c", "portal");
    expect(unassignedRepositories(list, file).map((entry) => entry.key)).toEqual(["github.com/acme/b"]);
  });

  it("edits a project's fields, rates and members, reading branches as a comma list", () => {
    let file = assignRepository(addProject(emptyProjectsFile(), "Portal"), "github.com/acme/web", "portal");
    file = updateProject(file, 0, { client: "ACME", rates: { markupPercent: 10, fixedLines: [{ label: "Seats", amount: 39, currency: "USD" }], currency: { code: "EUR", perUsd: 0.9 } } });
    file = updateMember(file, 0, 0, { path: "apps/web", branches: "main, release/*" });
    file = addMember(file, 0, "github.com/acme/api");
    expect(file.projects[0]).toMatchObject({
      client: "ACME",
      rates: { markupPercent: 10 },
      members: [{ repository: "github.com/acme/web", path: "apps/web", branches: ["main", "release/*"] }, { repository: "github.com/acme/api" }],
    });
    expect(branchesText(file.projects[0]!.members[0]!)).toBe("main, release/*");
    file = updateMember(file, 0, 0, { path: "", branches: "" });
    expect(file.projects[0]!.members[0]).toEqual({ repository: "github.com/acme/web" });
    file = removeMember(file, 0, 1);
    expect(file.projects[0]!.members).toHaveLength(1);
  });

  it("adds a capture rule for mitmproxy captures", () => {
    expect(addCaptureRule(emptyProjectsFile(), "captures/portal/*.har", "github.com/acme/web").captureRules).toEqual([{ glob: "captures/portal/*.har", repository: "github.com/acme/web" }]);
  });

  it("finds problems by where they are: an exact tie, an empty name, a project with no members (S6)", () => {
    const member = { repository: "github.com/acme/infra", branches: ["portal/*"] };
    const file: ProjectsFile = {
      ...emptyProjectsFile(),
      projects: [
        { id: "portal", name: "Customer portal", members: [member] },
        { id: "tools", name: "Internal tools", members: [member] },
        { id: "empty", name: " ", members: [] },
      ],
    };
    const problems = problemsOf(file);
    expect(problems.find((problem) => problem.path === "projects[1].members[0]")?.message).toMatch(/Exact tie/);
    expect(problems.map((problem) => problem.path)).toEqual(expect.arrayContaining(["projects[2].name", "projects[2].members"]));
    expect(problemsOf({ ...file, projects: file.projects.slice(0, 1) })).toEqual([]);
  });

  it("keeps a new project's id in step with its name until it is saved; a saved id never changes", () => {
    let file = addProject(emptyProjectsFile(), "New project");
    file = renameProject(file, 0, "Customer portal", new Set());
    expect(file.projects[0]).toMatchObject({ id: "customer-portal", name: "Customer portal" });
    file = renameProject(file, 0, "Portal (ACME)", new Set(["customer-portal"]));
    expect(file.projects[0]).toMatchObject({ id: "customer-portal", name: "Portal (ACME)" });
  });
});
