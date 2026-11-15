// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { priceBookListingSchema } from "@agent-cost-analyzer/domain";
import { composeStandaloneApp } from "./standalone-app.js";
import { isolatedLogProviders } from "./test-support/isolated-log-providers.js";
import { TEMP_LAYOUT, writeTempPackageLayout, type TempPackageLayout } from "./test-support/temp-package-layout.js";

const SERVER_PACKAGE_VERSION = (
  JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf-8")) as { version: string }
).version;

// npm-package.md §4.2 "Paths", task NP3: the standalone composition root reads
// every runtime file from a package layout when given one. The temp layout's
// data differ from this package's fixtures/, so each answer below shows which
// folder was read: none of them can come from an import.meta.url default.
describe("composeStandaloneApp with a package layout", () => {
  let temp: TempPackageLayout;
  let settings: string;
  let composed: ReturnType<typeof composeStandaloneApp>;

  beforeEach(() => {
    temp = writeTempPackageLayout();
    settings = mkdtempSync(path.join(tmpdir(), "standalone-app-"));
    composed = composeStandaloneApp({ ...isolatedLogProviders(settings), layout: temp.layout, warn: () => undefined });
  });

  afterEach(() => {
    temp.remove();
    rmSync(settings, { recursive: true, force: true });
  });

  it("reports the version of the layout's package.json", async () => {
    const response = await request(composed.app).get("/api/health");

    expect(composed.version).toBe(TEMP_LAYOUT.version);
    expect(response.body).toEqual({ app: "agent-cost-analyzer", status: "ok", version: TEMP_LAYOUT.version });
  });

  it("reads the learn scripts from the layout", async () => {
    const response = await request(composed.app).get("/api/learn/scenarios");

    expect(response.status).toBe(200);
    expect(response.body.map((scenario: { id: string }) => scenario.id)).toEqual(TEMP_LAYOUT.learnScenarioIds);
  });

  it("reads the vendor profiles from the layout", async () => {
    const response = await request(composed.app).get("/api/vendors");

    expect(response.status).toBe(200);
    expect(response.body.map((profile: { vendorId: string }) => profile.vendorId)).toEqual(TEMP_LAYOUT.vendorIds);
  });

  it("reads the price book from the layout", async () => {
    const response = await request(composed.app).get("/api/price-book");

    expect(response.status).toBe(200);
    expect(priceBookListingSchema.parse(response.body).channels).toEqual(TEMP_LAYOUT.priceBookChannels);
  });
});

// Dev defaults unchanged: without a layout every loader still finds this
// package's own files, as server.ts always has.
describe("composeStandaloneApp without a package layout", () => {
  let settings: string;
  let composed: ReturnType<typeof composeStandaloneApp>;

  beforeEach(() => {
    settings = mkdtempSync(path.join(tmpdir(), "standalone-app-dev-"));
    composed = composeStandaloneApp({ ...isolatedLogProviders(settings), warn: () => undefined });
  });

  afterEach(() => {
    rmSync(settings, { recursive: true, force: true });
  });

  it("reports the server package's version and reads this package's fixtures", async () => {
    const health = await request(composed.app).get("/api/health");
    const scenarios = await request(composed.app).get("/api/learn/scenarios");
    const vendors = await request(composed.app).get("/api/vendors");
    const priceBook = await request(composed.app).get("/api/price-book");

    expect(composed.version).toBe(SERVER_PACKAGE_VERSION);
    expect(health.body.version).toBe(SERVER_PACKAGE_VERSION);
    expect(scenarios.body).toHaveLength(18);
    expect(vendors.body.map((profile: { vendorId: string }) => profile.vendorId)).toContain("openai");
    expect(priceBookListingSchema.parse(priceBook.body).channels).toEqual(["anthropic-api", "github-copilot", "google-api", "openai-api"]);
  });
});

describe("composeStandaloneApp startup check", () => {
  it("prints the configuration warnings through warn, as server.ts did", () => {
    const settings = mkdtempSync(path.join(tmpdir(), "standalone-app-warn-"));
    const lines: string[] = [];
    try {
      // No VS Code settings.json (vscodeSettingsPath null): one warning.
      composeStandaloneApp({ ...isolatedLogProviders(settings), warn: (line) => lines.push(line) });
    } finally {
      rmSync(settings, { recursive: true, force: true });
    }

    expect(lines[0]).toBe("Configuration warnings (see GET /api/config/status for fix steps):");
    expect(lines.slice(1)).toEqual([expect.stringMatching(/^ {2}\[[a-z-]+\] /)]);
  });

  it("answers only the Host ports it is given", async () => {
    const settings = mkdtempSync(path.join(tmpdir(), "standalone-app-host-"));
    try {
      const { app } = composeStandaloneApp({ ...isolatedLogProviders(settings), allowedHostPorts: [4321], warn: () => undefined });

      expect((await request(app).get("/api/health").set("Host", "127.0.0.1:4321")).status).toBe(200);
      expect((await request(app).get("/api/health").set("Host", "127.0.0.1:3001")).status).toBe(403);
    } finally {
      rmSync(settings, { recursive: true, force: true });
    }
  });
});
