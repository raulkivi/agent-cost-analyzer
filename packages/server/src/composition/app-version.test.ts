import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readAppVersion } from "./app-version.js";

describe("readAppVersion", () => {
  it("defaults to the server package's own version", () => {
    const packageJsonPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../package.json");
    const { version } = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version: string };

    expect(readAppVersion()).toBe(version);
  });

  it("reads the version from an injected package.json path (G4: bundles can't use import.meta.url)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "app-version-"));
    try {
      const packageJsonPath = path.join(dir, "package.json");
      writeFileSync(packageJsonPath, JSON.stringify({ name: "x", version: "9.8.7" }));

      expect(readAppVersion(packageJsonPath)).toBe("9.8.7");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
