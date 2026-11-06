import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { costComparisonSchema, costSeriesSchema } from "@agent-cost-analyzer/domain";
import { createApp } from "./app.js";

// Phase 15 step 15.7: GET /api/cost/timeseries and /api/cost/compare over
// the real composition (no sessions here; the figures are covered by the
// golden test in services/cost-analysis/cost-analysis.golden.test.ts).
describe("cost analysis API", () => {
  let dir: string;
  let settingsDir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "app-cost-test-"));
    settingsDir = path.join(dir, "settings");
    mkdirSync(settingsDir);
    writeFileSync(path.join(settingsDir, "projects.json"), JSON.stringify({ version: 1, projects: [{ id: "acme", name: "ACME", members: [{ repository: "github.com/acme/web" }] }] }));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function buildApp() {
    return createApp(buildOptions());
  }

  function buildOptions() {
    return {
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
    };
  }

  it("GET /api/cost/timeseries answers a CostSeries with every bucket of the range", async () => {
    const response = await request(buildApp()).get("/api/cost/timeseries").query({ since: "2026-10-01", until: "2026-11-30", groupBy: "project", ids: "acme" });
    expect(response.status).toBe(200);
    const series = costSeriesSchema.parse(response.body);
    expect(series.points.map((point) => point.period)).toEqual(["2026-10", "2026-11"]);
    expect(series.series).toMatchObject([{ key: "acme", label: "ACME", turns: 0, total: { usd: null } }]);
  });

  it("GET /api/cost/compare answers a CostComparison", async () => {
    const response = await request(buildApp()).get("/api/cost/compare").query({ groupBy: "project", ids: "acme,other", since: "2026-10-01", until: "2026-10-31" });
    expect(response.status).toBe(200);
    expect(costComparisonSchema.parse(response.body).rows.map((row) => row.key)).toEqual(["acme", "other"]);
  });

  // Step 15.9 (plan §12.4.1): the clock port the usage-scenario suite fixes.
  it("prices and stamps with an injected clock", async () => {
    const app = createApp({ ...buildOptions(), now: () => new Date("2026-11-06T12:00:00.000Z") });
    const response = await request(app).get("/api/cost/timeseries").query({ since: "2026-10-01", until: "2026-10-31" });
    expect(response.status).toBe(200);
    expect(response.body.generatedAt).toBe("2026-11-06T12:00:00.000Z");
  });

  it("answers 400 for a bad query", async () => {
    const series = await request(buildApp()).get("/api/cost/timeseries").query({ bucket: "year" });
    expect(series.status).toBe(400);
    expect(series.body.error).toMatch(/bucket/);
    const compare = await request(buildApp()).get("/api/cost/compare").query({ groupBy: "project", ids: "acme" });
    expect(compare.status).toBe(400);
  });
});
