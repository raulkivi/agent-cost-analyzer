// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { savingsReportSchema } from "@agent-cost-analyzer/domain";
import { createApp } from "./app.js";

// Phase 16 step SR12 (docs/plans/savings-report.md §5.3, threat-model.md §11):
// GET /api/savings over the real standalone composition. Read-only, bounded
// (a validated query, the service's session cap), behind the loopback host
// guard like every route.
const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/claude-code");

describe("savings API", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "app-savings-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function buildApp(allowedHostPorts?: number[]) {
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
      now: () => new Date("2026-11-07T12:00:00.000Z"),
      ...(allowedHostPorts ? { allowedHostPorts } : {}),
    });
  }

  it("answers a schema-valid report over the 30-day window by default, with no path in it", async () => {
    const response = await request(buildApp()).get("/api/savings");

    expect(response.status).toBe(200);
    const report = savingsReportSchema.parse(response.body);
    expect(report.window).toEqual({ since: "2026-10-09", until: "2026-11-07", days: 30 });
    expect(report.pricing).toBe("as-of-use");
    expect(report.simulated).toEqual([]);
    expect(response.text).not.toContain(fixturesDir);
    expect(response.text).not.toContain(homedir());
    expect(response.text).not.toMatch(/\.jsonl/);
  });

  it("takes a window, a provider and a pricing mode, and runs the replays only when asked", async () => {
    const query = { since: "2026-01-01", until: "2026-11-30", provider: "claude-code", pricing: "today" };

    const plain = await request(buildApp()).get("/api/savings").query(query);
    const withReplay = await request(buildApp()).get("/api/savings").query({ ...query, includeSimulated: "true" });

    expect(plain.status).toBe(200);
    expect(savingsReportSchema.parse(plain.body)).toMatchObject({ window: { since: "2026-01-01", until: "2026-11-30" }, pricing: "today", simulated: [] });
    expect(withReplay.status).toBe(200);
    expect(savingsReportSchema.safeParse(withReplay.body).success).toBe(true);
  });

  it.each([
    [{ since: "yesterday" }],
    [{ until: "2026-13-45" }],
    [{ pricing: "cheapest" }],
    [{ includeSimulated: "maybe" }],
    [{ since: "2026-11-02", until: "2026-11-01" }],
    [{ provider: "not-a-provider" }],
  ])("answers 400 for %j", async (query) => {
    const response = await request(buildApp()).get("/api/savings").query(query);

    expect(response.status).toBe(400);
    expect(typeof response.body.error).toBe("string");
  });

  it("has no public limit: one is ignored", async () => {
    const response = await request(buildApp()).get("/api/savings").query({ limit: "1" });

    expect(response.status).toBe(200);
  });

  it("is GET only", async () => {
    const app = buildApp();

    for (const method of ["post", "put", "delete", "patch"] as const) {
      const response = await request(app)[method]("/api/savings").send({});
      expect(response.status, method).toBe(404);
    }
  });

  it("applies the loopback host guard as the other routes do", async () => {
    const app = buildApp();

    const foreign = await request(app).get("/api/savings").set("Host", "evil.example.com");
    const wrongPort = await request(buildApp([4123])).get("/api/savings").set("Host", "localhost:9999");
    const local = await request(buildApp([4123])).get("/api/savings").set("Host", "localhost:4123");

    expect(foreign.status).toBe(403);
    expect(wrongPort.status).toBe(403);
    expect(local.status).toBe(200);
  });
});
