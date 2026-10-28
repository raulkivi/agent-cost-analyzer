import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { insightsDatasetSchema } from "@agent-cost-analyzer/domain";
import { createApp } from "./app.js";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/claude-code-audit");

describe("GET /api/insights (Phase 9.11)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "app-insights-"));
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
      appSettingsDir: path.join(dir, "settings"),
      mitmproxyCapturesDirPath: null,
      piAgentSessionsDirPath: null,
      systemPromptLogPath: null,
      claudeCodeProjectsDirPath: fixturesDir,
    });
  }

  it("returns one dataset across every provider, whichever one is active", async () => {
    const response = await request(buildApp()).get("/api/insights");

    expect(response.status).toBe(200);
    const dataset = insightsDatasetSchema.parse(response.body);
    const claudeCode = dataset.providers.find((provider) => provider.id === "claude-code");
    expect(claudeCode).toMatchObject({ available: true, sessionCount: 1 });
    expect(dataset.providers.length).toBeGreaterThan(1);
    expect(dataset.sessions.every((session) => session.providerId === "claude-code")).toBe(true);
    expect(dataset.toolCalls).toHaveLength(13);
    expect(dataset.toolCalls.filter((call) => call.failureCategory === "command-not-found").length).toBeGreaterThan(0);
  });

  it("400s an invalid range or an unknown provider", async () => {
    const app = buildApp();
    expect((await request(app).get("/api/insights?since=yesterday")).status).toBe(400);
    expect((await request(app).get("/api/insights?limit=0")).status).toBe(400);
    expect((await request(app).get("/api/insights?provider=nope")).status).toBe(400);
  });
});
