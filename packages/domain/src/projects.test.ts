import { describe, expect, it } from "vitest";
import {
  emptyProjectsFile,
  normalizeMemberPath,
  projectListSchema,
  projectsFileSchema,
  projectsStateSchema,
  validateProjectsFile,
  type ProjectsFile,
} from "./projects.js";

const portal = {
  id: "customer-portal",
  name: "Customer portal",
  client: "Example Ltd",
  billingCode: "EX-2026-07",
  members: [
    { repository: "github.com/example/portal-web" },
    { repository: "github.com/example/platform", path: "services/portal-api" },
    { repository: "github.com/example/infra", branches: ["portal/*"] },
  ],
  rates: { markupPercent: 15 },
  includeSubscriptionUse: false,
};

function file(overrides: Partial<ProjectsFile> = {}): ProjectsFile {
  return projectsFileSchema.parse({ version: 1, projects: [portal], ...overrides });
}

describe("projectsFileSchema", () => {
  it("accepts the plan's §7 example and defaults the optional lists", () => {
    const parsed = projectsFileSchema.parse({ version: 1, projects: [portal] });

    expect(parsed.projects[0]).toEqual(portal);
    expect(parsed.aliases).toEqual({});
    expect(parsed.captureRules).toEqual([]);
  });

  it("accepts aliases and capture rules", () => {
    const parsed = projectsFileSchema.parse({
      version: 1,
      projects: [],
      aliases: { "path:/home/me/old-checkout": "github.com/example/portal-web" },
      captureRules: [{ glob: "~/captures/acme/*.har", repository: "github.com/example/portal-web" }],
    });

    expect(parsed.aliases).toEqual({ "path:/home/me/old-checkout": "github.com/example/portal-web" });
    expect(parsed.captureRules).toHaveLength(1);
  });

  it("is an empty, valid file by default", () => {
    expect(projectsFileSchema.parse(emptyProjectsFile())).toEqual({ version: 1, projects: [], aliases: {}, captureRules: [] });
  });

  it("rejects another version, a bad project id, an empty name and an empty member list", () => {
    expect(projectsFileSchema.safeParse({ version: 2, projects: [] }).success).toBe(false);
    expect(projectsFileSchema.safeParse({ version: 1, projects: [{ ...portal, id: "Has Spaces" }] }).success).toBe(false);
    expect(projectsFileSchema.safeParse({ version: 1, projects: [{ ...portal, name: "" }] }).success).toBe(false);
    expect(projectsFileSchema.safeParse({ version: 1, projects: [{ ...portal, members: [] }] }).success).toBe(false);
  });

  it("rejects a member path that is absolute or escapes the repository, and empty branch patterns", () => {
    const withMember = (member: object) => ({ version: 1, projects: [{ ...portal, members: [member] }] });

    expect(projectsFileSchema.safeParse(withMember({ repository: "r", path: "/etc" })).success).toBe(false);
    expect(projectsFileSchema.safeParse(withMember({ repository: "r", path: "a/../../b" })).success).toBe(false);
    expect(projectsFileSchema.safeParse(withMember({ repository: "r", branches: [] })).success).toBe(false);
    expect(projectsFileSchema.safeParse(withMember({ repository: "r", branches: [""] })).success).toBe(false);
  });

  it("rejects a negative or absurd markup", () => {
    expect(projectsFileSchema.safeParse({ version: 1, projects: [{ ...portal, rates: { markupPercent: -1 } }] }).success).toBe(false);
    expect(projectsFileSchema.safeParse({ version: 1, projects: [{ ...portal, rates: { markupPercent: 10_001 } }] }).success).toBe(false);
  });
});

describe("validateProjectsFile", () => {
  it("finds no problem in a well-formed file", () => {
    expect(validateProjectsFile(file())).toEqual([]);
  });

  it("reports a duplicate project id", () => {
    const copy = { ...portal, name: "Copy", members: [{ repository: "github.com/example/other" }] };
    const problems = validateProjectsFile(file({ projects: [portal, copy] }));

    expect(problems).toEqual([{ path: "projects[1].id", message: 'Project id "customer-portal" is used twice.' }]);
  });

  it("reports an exact tie between two projects (D1): same repository, path and branches", () => {
    const tools = { id: "internal-tools", name: "Internal tools", members: [{ repository: "github.com/example/infra", branches: ["portal/*"] }] };

    const problems = validateProjectsFile(file({ projects: [portal, tools] }));

    expect(problems).toEqual([
      {
        path: "projects[1].members[0]",
        message:
          'Exact tie: github.com/example/infra (branches portal/*) is also a member of "Customer portal". A turn can count in only one project; narrow one scope or remove one member.',
      },
    ]);
  });

  it("treats branch lists as sets and paths without trailing slashes when looking for ties", () => {
    const a = { id: "a", name: "A", members: [{ repository: "r", path: "svc/api/", branches: ["x", "y"] }] };
    const b = { id: "b", name: "B", members: [{ repository: "r", path: "svc/api", branches: ["y", "x"] }] };

    expect(validateProjectsFile(file({ projects: [a, b] }))).toHaveLength(1);
  });

  it("allows overlapping scopes that differ, which specificity decides", () => {
    const whole = { id: "a", name: "A", members: [{ repository: "github.com/example/platform" }] };
    const scoped = { id: "b", name: "B", members: [{ repository: "github.com/example/platform", path: "services/billing" }] };

    expect(validateProjectsFile(file({ projects: [whole, scoped] }))).toEqual([]);
  });

  it("reports the same member twice in one project", () => {
    const twice = { ...portal, members: [portal.members[0]!, portal.members[0]!] };

    expect(validateProjectsFile(file({ projects: [twice] }))).toEqual([
      { path: "projects[0].members[1]", message: "github.com/example/portal-web is listed twice in this project." },
    ]);
  });

  it("reports an alias to itself, an alias chain and a cycle", () => {
    const problems = validateProjectsFile(
      file({ aliases: { "path:/a": "path:/a", "path:/b": "path:/c", "path:/c": "github.com/x/y", "path:/d": "path:/e", "path:/e": "path:/d" } }),
    );

    expect(problems.map((problem) => problem.path)).toEqual(['aliases["path:/a"]', 'aliases["path:/b"]', 'aliases["path:/d"]', 'aliases["path:/e"]']);
    expect(problems[0]!.message).toMatch(/itself/);
    expect(problems[1]!.message).toMatch(/is itself an alias/);
  });
});

describe("projectsStateSchema", () => {
  it("accepts each status with its file, problems and location", () => {
    for (const status of ["missing", "valid", "invalid"] as const) {
      const sample = { status, file: emptyProjectsFile(), problems: [], location: "/home/dev/.config/agent-cost-analyzer/projects.json" };
      expect(projectsStateSchema.parse(sample)).toEqual(sample);
    }
  });

  it("rejects an unknown status", () => {
    expect(projectsStateSchema.safeParse({ status: "broken", file: emptyProjectsFile(), problems: [], location: "x" }).success).toBe(false);
  });
});

// CodeQL js/polynomial-redos (PR #137): normalizing a path must stay linear
// on adversarial input (a projects file is user content, up to 100 kB).
describe("normalizeMemberPath on adversarial input", () => {
  it("strips trailing slashes in linear time", () => {
    const started = performance.now();
    expect(normalizeMemberPath(`${"/".repeat(100_000)}x`)).toBe(`${"/".repeat(100_000)}x`);
    expect(normalizeMemberPath(`a${"/".repeat(100_000)}`)).toBe("a");
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("keeps its results", () => {
    expect(normalizeMemberPath("./svc/api//")).toBe("svc/api");
    expect(normalizeMemberPath(undefined)).toBe("");
    expect(normalizeMemberPath("///")).toBe("");
  });
});

describe("projectListSchema (MCP list_projects, step 15.4)", () => {
  it("accepts each project's id, name, client, billing code and member scopes, with the file's status and problems", () => {
    const sample = {
      status: "invalid",
      projects: [
        {
          id: portal.id,
          name: portal.name,
          client: portal.client,
          billingCode: portal.billingCode,
          members: portal.members,
        },
      ],
      problems: [{ path: "projects[0].members[1]", message: "Exact tie." }],
    };
    expect(projectListSchema.parse(sample)).toEqual(sample);
  });

  it("has no file location, rates or other local details", () => {
    const parsed = projectListSchema.parse({
      status: "valid",
      projects: [{ ...portal }],
      problems: [],
      location: "/home/dev/.config/app/projects.json",
    });
    expect(parsed).not.toHaveProperty("location");
    expect(parsed.projects[0]).not.toHaveProperty("rates");
  });
});
