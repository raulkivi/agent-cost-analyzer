import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { productProfileSchema } from "@copilot-cost-analyzer/domain";
import { createApp } from "./app.js";

const { version } = JSON.parse(
  readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf-8"),
) as { version: string };

describe("GET /api/product", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "app-test-product-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the standalone app's ProductProfile (vscode-extension.md §3.3)", async () => {
    const app = createApp({ appSettingsDir: path.join(dir, "app-settings") });

    const response = await request(app).get("/api/product");

    expect(response.status).toBe(200);
    expect(productProfileSchema.parse(response.body)).toEqual({
      productId: "standalone",
      displayName: "Agent Cost Analyzer",
      version,
      features: {
        providerSelect: true,
        crossProviderInsights: true,
        settingFixes: false,
        openInEditor: false,
      },
    });
  });

  it("reports the same version as /api/health", async () => {
    const app = createApp({ appSettingsDir: path.join(dir, "app-settings") });

    const [product, health] = await Promise.all([request(app).get("/api/product"), request(app).get("/api/health")]);

    expect(product.body.version).toBe(health.body.version);
  });
});
