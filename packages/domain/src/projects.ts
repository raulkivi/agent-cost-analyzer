import { z } from "zod";

// Phase 15 step 15.3 (docs/plans/cost-by-repository-and-project.md §7):
// the user's local projects file. Projects group repository members, each
// optionally narrowed to a path inside the repository and/or branch
// patterns. The schema checks each value; validateProjectsFile checks what
// a schema can't see across entries (duplicate ids, D1's exact ties, alias
// chains). Shared by the server (read and write) and, later, the web
// projects editor (inline validation, plan §11.5).

const relativePath = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/") && !value.split("/").includes(".."), {
    message: "path must be relative to the repository root and stay inside it",
  });

export const projectMemberSchema = z.object({
  // A repository key (RepositoryRef.key), e.g. "github.com/org/app".
  repository: z.string().min(1),
  path: relativePath.optional(),
  // Branch patterns: `*` matches within one path segment, `**` across them.
  branches: z.array(z.string().min(1)).min(1).optional(),
});

export const projectSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "id: lower-case letters, digits and hyphens, at most 64"),
  name: z.string().trim().min(1),
  client: z.string().min(1).optional(),
  billingCode: z.string().min(1).optional(),
  members: z.array(projectMemberSchema).min(1),
  rates: z.object({ markupPercent: z.number().min(0).max(10_000).optional() }).optional(),
  // D4: subscription (API-equivalent) use is left off statements unless set.
  includeSubscriptionUse: z.boolean().optional(),
});

export const captureRuleSchema = z.object({
  glob: z.string().min(1),
  repository: z.string().min(1),
});

export const projectsFileSchema = z.object({
  version: z.literal(1),
  projects: z.array(projectSchema),
  // Merge one repository key into another (a moved folder, a fork).
  aliases: z.record(z.string().min(1), z.string().min(1)).default({}),
  // mitmproxy captures record no folder: assign capture files to a repository.
  captureRules: z.array(captureRuleSchema).default([]),
  // Channel overrides and contract prices; their shape is step 15.5's.
  channels: z
    .object({
      providers: z.record(z.string(), z.string()).optional(),
      priceVersions: z.array(z.unknown()).optional(),
    })
    .optional(),
});

export const projectFileProblemSchema = z.object({
  // Where in the file, e.g. "projects[1].members[0]" or 'aliases["path:/a"]'.
  path: z.string(),
  message: z.string(),
});

// What the app holds for the projects file (GET /api/projects): "missing"
// is a valid, empty file; "invalid" keeps a schema-valid file whose
// problems are only cross-entry ones, else falls back to an empty file so
// cost by repository still works — the problems say what to fix.
export const projectsStateSchema = z.object({
  status: z.enum(["missing", "valid", "invalid"]),
  file: projectsFileSchema,
  problems: z.array(projectFileProblemSchema),
  location: z.string(),
});

// Phase 15 step 15.4: the MCP list_projects result. Only what a client
// model needs to name and scope projects: no file location (a local path),
// rates or capture rules.
export const projectListEntrySchema = projectSchema.pick({ id: true, name: true, client: true, billingCode: true, members: true });

export const projectListSchema = z.object({
  status: projectsStateSchema.shape.status,
  projects: z.array(projectListEntrySchema),
  problems: z.array(projectFileProblemSchema),
});

export type ProjectListEntry = z.infer<typeof projectListEntrySchema>;
export type ProjectList = z.infer<typeof projectListSchema>;
export type ProjectMember = z.infer<typeof projectMemberSchema>;
export type Project = z.infer<typeof projectSchema>;
export type CaptureRule = z.infer<typeof captureRuleSchema>;
export type ProjectsFile = z.infer<typeof projectsFileSchema>;
export type ProjectFileProblem = z.infer<typeof projectFileProblemSchema>;
export type ProjectsState = z.infer<typeof projectsStateSchema>;

export function emptyProjectsFile(): ProjectsFile {
  return { version: 1, projects: [], aliases: {}, captureRules: [] };
}

// A loop, not /\/+$/: that regex is quadratic on a long run of "/" not at
// the end (CodeQL js/polynomial-redos), and the file is user content.
export function normalizeMemberPath(path: string | undefined): string {
  const value = (path ?? "").startsWith("./") ? (path ?? "").slice(2) : (path ?? "");
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") {
    end -= 1;
  }
  return value.slice(0, end);
}

function scopeKey(member: ProjectMember): string {
  const branches = [...(member.branches ?? [])].sort().join("\u0001");
  return `${member.repository}\u0000${normalizeMemberPath(member.path)}\u0000${branches}`;
}

function describeScope(member: ProjectMember): string {
  const parts = [
    ...(member.path ? [`path ${member.path}`] : []),
    ...(member.branches ? [`branches ${member.branches.join(", ")}`] : []),
  ];
  return parts.length > 0 ? `${member.repository} (${parts.join(", ")})` : member.repository;
}

export function validateProjectsFile(file: ProjectsFile): ProjectFileProblem[] {
  const problems: ProjectFileProblem[] = [];

  const ids = new Set<string>();
  file.projects.forEach((project, index) => {
    if (ids.has(project.id)) {
      problems.push({ path: `projects[${index}].id`, message: `Project id "${project.id}" is used twice.` });
    }
    ids.add(project.id);
  });

  const owners = new Map<string, { projectIndex: number; name: string }>();
  file.projects.forEach((project, projectIndex) => {
    project.members.forEach((member, memberIndex) => {
      const key = scopeKey(member);
      const owner = owners.get(key);
      const path = `projects[${projectIndex}].members[${memberIndex}]`;
      if (!owner) {
        owners.set(key, { projectIndex, name: project.name });
      } else if (owner.projectIndex === projectIndex) {
        problems.push({ path, message: `${describeScope(member)} is listed twice in this project.` });
      } else {
        problems.push({
          path,
          message: `Exact tie: ${describeScope(member)} is also a member of "${owner.name}". A turn can count in only one project; narrow one scope or remove one member.`,
        });
      }
    });
  });

  for (const [source, target] of Object.entries(file.aliases)) {
    const path = `aliases[${JSON.stringify(source)}]`;
    if (source === target) {
      problems.push({ path, message: `${source} is an alias of itself.` });
    } else if (target in file.aliases) {
      problems.push({ path, message: `${source} points to ${target}, which is itself an alias; point it at the final repository key.` });
    }
  }

  return problems;
}
