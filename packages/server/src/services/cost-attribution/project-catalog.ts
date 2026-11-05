import {
  emptyProjectsFile,
  projectsFileSchema,
  validateProjectsFile,
  type ProjectFileProblem,
  type ProjectsFile,
  type ProjectsState,
} from "@agent-cost-analyzer/domain";
import type { ProjectStore } from "./project-store.js";

// Phase 15 step 15.3 (docs/plans/cost-by-repository-and-project.md §7):
// reads and writes the projects file through a ProjectStore. Loading never
// fails: a missing file is an empty one, and a broken one falls back to an
// empty file with its problems listed (a config warning), so cost by
// repository keeps working. Saving is strict: a file with any problem is
// rejected and nothing is written (the editor keeps Save disabled, §11.5).

export class ProjectsFileRejectedError extends Error {
  constructor(readonly problems: ProjectFileProblem[]) {
    super(`The projects file has ${problems.length} problem${problems.length === 1 ? "" : "s"}: ${problems[0]?.message ?? ""}`);
    this.name = "ProjectsFileRejectedError";
  }
}

// zod's issue path as the file's own notation: projects[1].members[0].path.
function formatPath(path: readonly PropertyKey[]): string {
  return path
    .map((part, index) => (typeof part === "number" ? `[${part}]` : index === 0 ? String(part) : `.${String(part)}`))
    .join("");
}

type Checked = { file: ProjectsFile; problems: ProjectFileProblem[] };

function check(candidate: unknown): Checked {
  const parsed = projectsFileSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      file: emptyProjectsFile(),
      problems: parsed.error.issues.map((issue) => ({ path: formatPath(issue.path), message: issue.message })),
    };
  }
  return { file: parsed.data, problems: validateProjectsFile(parsed.data) };
}

export class ProjectCatalog {
  constructor(private readonly store: ProjectStore) {}

  load(): ProjectsState {
    const location = this.store.location;
    const read = this.store.read();
    if (read.status === "missing") {
      return { status: "missing", file: emptyProjectsFile(), problems: [], location };
    }
    if (read.status === "unreadable") {
      return { status: "invalid", file: emptyProjectsFile(), problems: [{ path: "", message: read.reason }], location };
    }
    let json: unknown;
    try {
      json = JSON.parse(read.text);
    } catch (error) {
      return {
        status: "invalid",
        file: emptyProjectsFile(),
        problems: [{ path: "", message: `Not valid JSON: ${(error as Error).message}` }],
        location,
      };
    }
    const { file, problems } = check(json);
    return { status: problems.length === 0 ? "valid" : "invalid", file, problems, location };
  }

  save(candidate: unknown): ProjectsState {
    const { file, problems } = check(candidate);
    if (problems.length > 0) {
      throw new ProjectsFileRejectedError(problems);
    }
    this.store.write(`${JSON.stringify(file, null, 2)}\n`);
    return this.load();
  }
}
