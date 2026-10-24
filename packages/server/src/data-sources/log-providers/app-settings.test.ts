import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ACTIVE_PROVIDER_ID,
  readActiveProviderId,
  readMinRetainedSessionLogsThreshold,
  writeActiveProviderId,
  writeMinRetainedSessionLogsThreshold,
} from "./app-settings.js";

describe("app-settings (active provider persistence)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "app-settings-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to 'vscode' when no settings file exists yet", () => {
    expect(readActiveProviderId(dir)).toBe(DEFAULT_ACTIVE_PROVIDER_ID);
  });

  it("round-trips a written active provider id", () => {
    writeActiveProviderId(dir, "mitmproxy");

    expect(readActiveProviderId(dir)).toBe("mitmproxy");
  });

  it("degrades to the default when the settings file is corrupt", () => {
    writeFileSync(path.join(dir, "settings.json"), "{not valid json", "utf-8");

    expect(readActiveProviderId(dir)).toBe(DEFAULT_ACTIVE_PROVIDER_ID);
  });

  it("creates the settings directory if it doesn't exist yet", () => {
    const nestedDir = path.join(dir, "nested", "config");

    writeActiveProviderId(nestedDir, "vscode");

    expect(readActiveProviderId(nestedDir)).toBe("vscode");
  });
});

describe("app-settings (retention threshold persistence)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "app-settings-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns undefined when no settings file exists yet", () => {
    expect(readMinRetainedSessionLogsThreshold(dir)).toBeUndefined();
  });

  it("round-trips a written threshold", () => {
    writeMinRetainedSessionLogsThreshold(dir, 300);

    expect(readMinRetainedSessionLogsThreshold(dir)).toBe(300);
  });

  it("degrades to undefined when the settings file is corrupt", () => {
    writeFileSync(path.join(dir, "settings.json"), "{not valid json", "utf-8");

    expect(readMinRetainedSessionLogsThreshold(dir)).toBeUndefined();
  });

  it("degrades to undefined when the key is missing or not a number", () => {
    writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({ minRetainedSessionLogsThreshold: "not-a-number" }),
      "utf-8",
    );

    expect(readMinRetainedSessionLogsThreshold(dir)).toBeUndefined();
  });

  it("creates the settings directory if it doesn't exist yet", () => {
    const nestedDir = path.join(dir, "nested", "config");

    writeMinRetainedSessionLogsThreshold(nestedDir, 150);

    expect(readMinRetainedSessionLogsThreshold(nestedDir)).toBe(150);
  });

  it("coexists with activeProviderId: writing one preserves the other, in both orders", () => {
    writeActiveProviderId(dir, "mitmproxy");
    writeMinRetainedSessionLogsThreshold(dir, 300);

    expect(readActiveProviderId(dir)).toBe("mitmproxy");
    expect(readMinRetainedSessionLogsThreshold(dir)).toBe(300);

    const dir2 = mkdtempSync(path.join(tmpdir(), "app-settings-"));
    try {
      writeMinRetainedSessionLogsThreshold(dir2, 100);
      writeActiveProviderId(dir2, "mitmproxy");

      expect(readMinRetainedSessionLogsThreshold(dir2)).toBe(100);
      expect(readActiveProviderId(dir2)).toBe("mitmproxy");
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});
