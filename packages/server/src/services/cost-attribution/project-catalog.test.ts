import { describe, expect, it } from "vitest";
import { emptyProjectsFile, projectsFileSchema, projectsStateSchema } from "@agent-cost-analyzer/domain";
import { InMemoryProjectStore } from "../../test-support/in-memory-project-store.js";
import { ProjectCatalog, ProjectsFileRejectedError } from "./project-catalog.js";

const valid = {
  version: 1,
  projects: [{ id: "portal", name: "Portal", members: [{ repository: "github.com/example/portal-web" }] }],
};

describe("ProjectCatalog.load", () => {
  it("treats a missing file as an empty, valid one", () => {
    const state = new ProjectCatalog(new InMemoryProjectStore()).load();

    expect(state).toEqual({ status: "missing", file: emptyProjectsFile(), problems: [], location: "/settings/projects.json" });
    expect(projectsStateSchema.parse(state)).toEqual(state);
  });

  it("reads a valid file", () => {
    const state = new ProjectCatalog(new InMemoryProjectStore(JSON.stringify(valid))).load();

    expect(state.status).toBe("valid");
    expect(state.file).toEqual(projectsFileSchema.parse(valid));
    expect(state.problems).toEqual([]);
  });

  it("falls back to an empty file, with the reason, when the file isn't JSON", () => {
    const state = new ProjectCatalog(new InMemoryProjectStore("{ not json")).load();

    expect(state.status).toBe("invalid");
    expect(state.file).toEqual(emptyProjectsFile());
    expect(state.problems).toHaveLength(1);
    expect(state.problems[0]!.path).toBe("");
    expect(state.problems[0]!.message).toMatch(/^Not valid JSON/);
  });

  it("falls back to an empty file and lists each schema error with its path", () => {
    const broken = { version: 1, projects: [{ id: "Bad Id", name: "", members: [{ repository: "r", path: "/abs" }] }] };

    const state = new ProjectCatalog(new InMemoryProjectStore(JSON.stringify(broken))).load();

    expect(state.status).toBe("invalid");
    expect(state.file).toEqual(emptyProjectsFile());
    expect(state.problems.map((problem) => problem.path).sort()).toEqual(["projects[0].id", "projects[0].members[0].path", "projects[0].name"]);
  });

  it("keeps a schema-valid file whose only problems are across entries, and lists them", () => {
    const tie = {
      version: 1,
      projects: [
        { id: "a", name: "A", members: [{ repository: "r" }] },
        { id: "b", name: "B", members: [{ repository: "r" }] },
      ],
    };

    const state = new ProjectCatalog(new InMemoryProjectStore(JSON.stringify(tie))).load();

    expect(state.status).toBe("invalid");
    expect(state.file.projects).toHaveLength(2);
    expect(state.problems[0]!.message).toMatch(/^Exact tie/);
  });

  it("reports a file the store can't read as invalid, with the store's reason", () => {
    const state = new ProjectCatalog(new InMemoryProjectStore(null, "/settings/projects.json is larger than 1048576 bytes.")).load();

    expect(state).toMatchObject({ status: "invalid", problems: [{ path: "", message: "/settings/projects.json is larger than 1048576 bytes." }] });
  });
});

describe("ProjectCatalog.save", () => {
  it("writes a valid file as indented JSON and returns the new state", () => {
    const store = new InMemoryProjectStore();

    const state = new ProjectCatalog(store).save(valid);

    expect(state.status).toBe("valid");
    expect(store.current).toBe(`${JSON.stringify(projectsFileSchema.parse(valid), null, 2)}\n`);
  });

  it("rejects a file with schema errors, lists them, and writes nothing", () => {
    const store = new InMemoryProjectStore(JSON.stringify(valid));

    let rejected: unknown;
    try {
      new ProjectCatalog(store).save({ version: 1, projects: [{ id: "x", name: "X", members: [] }] });
    } catch (error) {
      rejected = error;
    }

    expect(rejected).toBeInstanceOf(ProjectsFileRejectedError);
    expect((rejected as ProjectsFileRejectedError).problems).toEqual([{ path: "projects[0].members", message: expect.any(String) }]);
    expect(store.writes).toBe(0);
  });

  it("rejects a file with an exact tie (D1) and writes nothing", () => {
    const store = new InMemoryProjectStore();
    const tie = {
      version: 1,
      projects: [
        { id: "a", name: "A", members: [{ repository: "r" }] },
        { id: "b", name: "B", members: [{ repository: "r" }] },
      ],
    };

    expect(() => new ProjectCatalog(store).save(tie)).toThrow(ProjectsFileRejectedError);
    expect(store.writes).toBe(0);
  });

  it("rejects something that isn't an object at all", () => {
    expect(() => new ProjectCatalog(new InMemoryProjectStore()).save("projects")).toThrow(ProjectsFileRejectedError);
  });
});
