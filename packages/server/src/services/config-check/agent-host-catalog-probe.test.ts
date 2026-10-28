import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agentHostCatalogProbe } from "./agent-host-catalog-probe.js";

describe("agentHostCatalogProbe", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("is false without a user-data dir", () => {
    expect(agentHostCatalogProbe(null)()).toBe(false);
  });

  it("is false while agent-host.db is missing and true once it exists", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ah-probe-"));
    dirs.push(dir);
    const probe = agentHostCatalogProbe(dir);
    expect(probe()).toBe(false);
    mkdirSync(path.join(dir, "User", "globalStorage"), { recursive: true });
    writeFileSync(path.join(dir, "User", "globalStorage", "agent-host.db"), "");
    expect(probe()).toBe(true);
  });
});
