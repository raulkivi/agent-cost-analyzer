import {
  projectsFileSchema,
  validateProjectsFile,
  type Project,
  type ProjectFileProblem,
  type ProjectMember,
  type ProjectsFile,
  type RepositoryList,
  type RepositoryListEntry,
} from "@agent-cost-analyzer/domain";

// Phase 15 step 15.11 (docs/plans/cost-by-repository-and-project.md §7,
// §11.5; board 5): the Projects editor's edits as pure functions over the
// projects file, and its validation: the domain's schema, then its
// cross-entry checks (D1's exact ties, duplicate ids), each problem keyed by
// where it is ("projects[1].members[0]") so the editor shows it inline.

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "project";

export function addProject(file: ProjectsFile, name: string): ProjectsFile {
  const base = slug(name);
  const taken = new Set(file.projects.map((project) => project.id));
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  return { ...file, projects: [...file.projects, { id, name, members: [] }] };
}

// A saved project's id names its statements, so it never changes; a new
// one's follows its name (unique) until the file is saved.
export function renameProject(file: ProjectsFile, index: number, name: string, savedIds: ReadonlySet<string>): ProjectsFile {
  const project = file.projects[index];
  if (!project) return file;
  if (savedIds.has(project.id)) return updateProject(file, index, { name });
  const others = new Set(file.projects.filter((_, i) => i !== index).map((other) => other.id));
  const base = slug(name);
  let id = base;
  for (let n = 2; others.has(id); n += 1) id = `${base}-${n}`;
  return { ...file, projects: file.projects.map((p, i) => (i === index ? { ...p, id, name } : p)) };
}

export function updateProject(file: ProjectsFile, index: number, patch: Partial<Omit<Project, "members">>): ProjectsFile {
  return { ...file, projects: file.projects.map((project, i) => (i === index ? withoutEmpty({ ...project, ...patch }) : project)) };
}

export function removeProject(file: ProjectsFile, index: number): ProjectsFile {
  return { ...file, projects: file.projects.filter((_, i) => i !== index) };
}

// Optional text fields cleared in the form are left out, not saved as "".
function withoutEmpty(project: Project): Project {
  const copy = { ...project };
  if (copy.client === "") delete copy.client;
  if (copy.billingCode === "") delete copy.billingCode;
  return copy;
}

export function assignRepository(file: ProjectsFile, repository: string, projectId: string): ProjectsFile {
  return { ...file, projects: file.projects.map((project) => (project.id === projectId ? { ...project, members: [...project.members, { repository }] } : project)) };
}

export function addMember(file: ProjectsFile, projectIndex: number, repository: string): ProjectsFile {
  return { ...file, projects: file.projects.map((project, i) => (i === projectIndex ? { ...project, members: [...project.members, { repository }] } : project)) };
}

export function removeMember(file: ProjectsFile, projectIndex: number, memberIndex: number): ProjectsFile {
  return { ...file, projects: file.projects.map((project, i) => (i === projectIndex ? { ...project, members: project.members.filter((_, m) => m !== memberIndex) } : project)) };
}

// The form edits a path and a comma list of branch patterns; empty means
// the whole repository or every branch, so the key is left out.
export function updateMember(file: ProjectsFile, projectIndex: number, memberIndex: number, patch: { path?: string; branches?: string }): ProjectsFile {
  const edit = (member: ProjectMember): ProjectMember => {
    const next: ProjectMember = { repository: member.repository };
    const path = patch.path ?? member.path ?? "";
    const branches = patch.branches !== undefined ? patch.branches.split(",").map((branch) => branch.trim()).filter(Boolean) : (member.branches ?? []);
    if (path.trim() !== "") next.path = path.trim();
    if (branches.length > 0) next.branches = branches;
    return next;
  };
  return {
    ...file,
    projects: file.projects.map((project, i) => (i === projectIndex ? { ...project, members: project.members.map((member, m) => (m === memberIndex ? edit(member) : member)) } : project)),
  };
}

export const branchesText = (member: ProjectMember) => (member.branches ?? []).join(", ");

export function addCaptureRule(file: ProjectsFile, glob: string, repository: string): ProjectsFile {
  return { ...file, captureRules: [...file.captureRules, { glob, repository }] };
}

export function updateCaptureRule(file: ProjectsFile, index: number, patch: { glob?: string; repository?: string }): ProjectsFile {
  return { ...file, captureRules: file.captureRules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)) };
}

export function removeCaptureRule(file: ProjectsFile, index: number): ProjectsFile {
  return { ...file, captureRules: file.captureRules.filter((_, i) => i !== index) };
}

// Repositories no project in the (unsaved) file claims, most sessions first.
export function unassignedRepositories(list: RepositoryList, file: ProjectsFile): RepositoryListEntry[] {
  const claimed = new Set(file.projects.flatMap((project) => project.members.map((member) => member.repository)));
  return list.repositories
    .filter((entry) => !claimed.has(entry.key))
    .sort((a, b) => b.sessionCount - a.sessionCount || a.key.localeCompare(b.key));
}

const pathOf = (segments: readonly PropertyKey[]) =>
  segments.reduce<string>((text, segment) => (typeof segment === "number" ? `${text}[${segment}]` : text === "" ? String(segment) : `${text}.${String(segment)}`), "");

export function problemsOf(file: ProjectsFile): ProjectFileProblem[] {
  // Both kinds at once, so fixing one problem never uncovers a hidden one.
  const parsed = projectsFileSchema.safeParse(file);
  const schemaProblems = parsed.success
    ? []
    : parsed.error.issues.map((issue) => ({
        path: pathOf(issue.path),
        message: issue.code === "too_small" && issue.path.at(-1) === "members" ? "Add at least one repository to the project." : issue.message,
      }));
  const seen = new Set(schemaProblems.map((problem) => `${problem.path}\u0000${problem.message}`));
  return [...schemaProblems, ...validateProjectsFile(file).filter((problem) => !seen.has(`${problem.path}\u0000${problem.message}`))];
}
