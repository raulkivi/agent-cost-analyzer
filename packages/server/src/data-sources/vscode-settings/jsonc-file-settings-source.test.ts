import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { describeSettingsSourceContract } from "../../services/config-check/settings-source-contract.js";
import { JsoncFileSettingsSource } from "./jsonc-file-settings-source.js";

const dir = mkdtempSync(path.join(tmpdir(), "jsonc-settings-source-"));
let fileCount = 0;

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeSettings(content: string): string {
  const settingsPath = path.join(dir, `settings-${++fileCount}.json`);
  writeFileSync(settingsPath, content);
  return settingsPath;
}

describeSettingsSourceContract("JsoncFileSettingsSource", {
  build: (values) => new JsoncFileSettingsSource(writeSettings(JSON.stringify(values))),
});

describe("JsoncFileSettingsSource", () => {
  it("reads JSONC: comments and trailing commas", () => {
    const source = new JsoncFileSettingsSource(writeSettings('{\n // on\n "a.b": true,\n}'));

    expect(source.get("a.b")).toBe(true);
  });

  it("is located and reports its file path", () => {
    const settingsPath = writeSettings("{}");

    expect(new JsoncFileSettingsSource(settingsPath).describe()).toEqual({ located: true, userSettingsPath: settingsPath });
  });

  it("is not located without a path, and has no values", () => {
    const source = new JsoncFileSettingsSource(null);

    expect(source.describe()).toEqual({ located: false, userSettingsPath: null });
    expect(source.get("a.b")).toBeUndefined();
  });

  it("keeps the path but has no values when the file can't be read", () => {
    const missing = path.join(dir, "missing.json");
    const source = new JsoncFileSettingsSource(missing);

    expect(source.describe()).toEqual({ located: true, userSettingsPath: missing });
    expect(source.get("a.b")).toBeUndefined();
  });

  it("has no values for a file that isn't a JSON object", () => {
    expect(new JsoncFileSettingsSource(writeSettings("[1, 2]")).get("0")).toBeUndefined();
    expect(new JsoncFileSettingsSource(writeSettings("")).get("a")).toBeUndefined();
  });
});
