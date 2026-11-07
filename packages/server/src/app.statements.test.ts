import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { costEstimateSchema, statementAnswerSchema } from "@agent-cost-analyzer/domain";
import { createApp } from "./app.js";

// Phase 15 step 15.11 (plan §8.5, §10, threat model): GET /api/statements
// and POST /api/statements/:projectId/:period/issue over the real
// composition. Issuing writes a file, so it takes a JSON body only: a
// cross-origin page can't send one without a preflight the server never
// answers (a form POST is refused with 415).
describe("statements API", () => {
  let dir: string;
  let settingsDir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "app-statements-test-"));
    settingsDir = path.join(dir, "settings");
    mkdirSync(settingsDir);
    writeFileSync(path.join(settingsDir, "projects.json"), JSON.stringify({ version: 1, projects: [{ id: "acme", name: "ACME", members: [{ repository: "github.com/acme/web" }] }] }));
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
      claudeCodeProjectsDirPath: null,
      now: () => new Date("2026-11-06T12:00:00.000Z"),
      timeZone: "UTC",
    });
  }

  it("GET /api/statements answers the draft and whether it can be issued", async () => {
    const response = await request(buildApp()).get("/api/statements").query({ projectId: "acme", period: "2026-10" });
    expect(response.status).toBe(200);
    const answer = statementAnswerSchema.parse(response.body);
    expect(answer).toMatchObject({ statement: { status: "draft", project: { id: "acme", name: "ACME" }, period: { key: "2026-10", timeZone: "UTC" } }, canIssue: { ok: true }, issuedPeriods: [] });
  });

  it("answers 404 for an unknown project and 400 for a bad or missing period or project", async () => {
    expect((await request(buildApp()).get("/api/statements").query({ projectId: "nope", period: "2026-10" })).status).toBe(404);
    expect((await request(buildApp()).get("/api/statements").query({ projectId: "acme", period: "October" })).status).toBe(400);
    expect((await request(buildApp()).get("/api/statements").query({ projectId: "acme" })).status).toBe(400);
    expect((await request(buildApp()).get("/api/statements").query({ period: "2026-10" })).status).toBe(400);
  });

  it("POST .../issue freezes the draft into the settings folder once, then answers 409", async () => {
    const app = buildApp();
    const issued = await request(app).post("/api/statements/acme/2026-10/issue").send({});
    expect(issued.status).toBe(200);
    expect(statementAnswerSchema.parse(issued.body).statement).toMatchObject({ status: "issued", issuedAt: "2026-11-06T12:00:00.000Z" });
    expect(existsSync(path.join(settingsDir, "statements", "acme", "2026-10.json"))).toBe(true);
    const again = await request(app).post("/api/statements/acme/2026-10/issue").send({});
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already issued/i);
    const get = await request(app).get("/api/statements").query({ projectId: "acme", period: "2026-10" });
    expect(get.body).toMatchObject({ statement: { status: "issued" }, diff: { changed: false }, issuedPeriods: ["2026-10"] });
  });

  it("refuses to issue a period that hasn't ended (409), an unknown project (404) and a bad period (400)", async () => {
    const app = buildApp();
    const open = await request(app).post("/api/statements/acme/2026-11/issue").send({});
    expect(open.status).toBe(409);
    expect(open.body.error).toMatch(/hasn't ended/);
    expect((await request(app).post("/api/statements/nope/2026-10/issue").send({})).status).toBe(404);
    expect((await request(app).post("/api/statements/acme/October/issue").send({})).status).toBe(400);
  });

  it("refuses an issue request that isn't JSON (a cross-origin form post) with 415 and writes nothing", async () => {
    const app = buildApp();
    const form = await request(app).post("/api/statements/acme/2026-10/issue").type("form").send("confirm=1");
    expect(form.status).toBe(415);
    const text = await request(app).post("/api/statements/acme/2026-10/issue").set("Content-Type", "text/plain").send("{}");
    expect(text.status).toBe(415);
    expect(existsSync(path.join(settingsDir, "statements"))).toBe(false);
  });

  // Step 15.12 (plan §8.6, §10): estimates.
  it("GET /api/estimates answers an estimate (no range on an empty history), 404 for an unknown project, 400 for a bad query", async () => {
    const response = await request(buildApp()).get("/api/estimates").query({ projectId: "acme", activeDays: "20" });
    expect(response.status).toBe(200);
    expect(costEstimateSchema.parse(response.body)).toMatchObject({ label: "estimate", pricing: "today", range: null, refusal: expect.stringMatching(/needs at least 5/) });
    expect((await request(buildApp()).get("/api/estimates").query({ projectId: "nope", activeDays: "20" })).status).toBe(404);
    expect((await request(buildApp()).get("/api/estimates").query({ projectId: "acme" })).status).toBe(400);
  });
});
