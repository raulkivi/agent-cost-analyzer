import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configStatusSchema, projectsStateSchema, repositoryListSchema } from "@agent-cost-analyzer/domain";
import { createApp } from "./app.js";

// Phase 15 step 15.3: GET/PUT /api/projects and GET /api/repositories over
// the real composition (file store in the app settings folder).
const claudeCodeFixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/claude-code");

describe("projects API", () => {
  let dir: string;
  let settingsDir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "app-projects-test-"));
    settingsDir = path.join(dir, "settings");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function buildApp() {
    return createApp({
      sessionStoreDbPath: path.join(dir, "missing.db"),
      debugLogsDirPaths: [],
      vscodeSettingsPath: null,
      agentTracesDbPath: null,
      agentHostUserDataDir: null,
      appSettingsDir: settingsDir,
      mitmproxyCapturesDirPath: null,
      piAgentSessionsDirPath: null,
      systemPromptLogPath: null,
      claudeCodeProjectsDirPath: claudeCodeFixtures,
    });
  }

  const validFile = {
    version: 1,
    projects: [{ id: "project", name: "Project", members: [{ repository: "path:/home/dev/project" }] }],
  };

  it("GET /api/projects reports a missing file as missing, at projects.json in the settings folder", async () => {
    const response = await request(buildApp()).get("/api/projects");

    expect(response.status).toBe(200);
    expect(projectsStateSchema.parse(response.body)).toMatchObject({ status: "missing", location: path.join(settingsDir, "projects.json") });
  });

  it("PUT /api/projects writes a valid file, and GET reads it back", async () => {
    const app = buildApp();

    const put = await request(app).put("/api/projects").send(validFile);
    const get = await request(app).get("/api/projects");

    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ status: "valid" });
    expect(get.body.file.projects[0].id).toBe("project");
    expect(JSON.parse(readFileSync(path.join(settingsDir, "projects.json"), "utf-8")).projects).toHaveLength(1);
  });

  it("PUT /api/projects rejects an invalid file with 400, the error and its problems, and writes nothing", async () => {
    const response = await request(buildApp()).put("/api/projects").send({ version: 1, projects: [{ id: "Bad Id", name: "X", members: [] }] });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/^The projects file has 2 problems/);
    expect(response.body.problems.map((problem: { path: string }) => problem.path).sort()).toEqual(["projects[0].id", "projects[0].members"]);
    expect(existsSync(path.join(settingsDir, "projects.json"))).toBe(false);
  });

  it("GET /api/repositories lists the fixture sessions' repository with its project", async () => {
    const app = buildApp();
    await request(app).put("/api/projects").send(validFile);

    const response = await request(app).get("/api/repositories");

    expect(response.status).toBe(200);
    const list = repositoryListSchema.parse(response.body);
    // /home/dev/project doesn't exist on this machine, so it keys by its path.
    expect(list.repositories).toEqual([
      expect.objectContaining({ key: "path:/home/dev/project", source: "folder-path", providerIds: ["claude-code"], projectIds: ["project"] }),
    ]);
    expect(list.providers.find((provider) => provider.id === "claude-code")).toMatchObject({ available: true });
  });

  it("GET /api/config/status warns, as optional, when projects.json is broken", async () => {
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(path.join(settingsDir, "projects.json"), "{ not json");

    const response = await request(buildApp()).get("/api/config/status");

    const status = configStatusSchema.parse(response.body);
    expect(status.warnings.find((warning) => warning.code === "projects-file-invalid")).toMatchObject({ severity: "optional" });
  });
});
