// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import * as nodeFs from "node:fs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileAllowanceSettingsStore } from "./file-allowance-settings-store.js";
import { FileAppSettingsStore } from "./app-settings.js";

const valid = { aiCredits: 1000, resetDay: 5, warnAtPercent: 90 };
const defaults = { aiCredits: null, resetDay: 1, warnAtPercent: 80 };

describe("FileAllowanceSettingsStore", () => {
  let dir: string;
  const file = () => path.join(dir, "settings.json");

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "allowance-store-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads not set and the defaults when nothing is stored", () => {
    expect(new FileAllowanceSettingsStore(dir).read()).toEqual(defaults);
  });

  it("reads the defaults for a malformed or partial file", () => {
    const store = new FileAllowanceSettingsStore(dir);
    writeFileSync(file(), "{not json", "utf-8");
    expect(store.read()).toEqual(defaults);
    writeFileSync(
      file(),
      JSON.stringify({ monthlyAllowance: { aiCredits: 500, resetDay: 99, warnAtPercent: "x" } }),
      "utf-8",
    );
    expect(store.read()).toEqual({ aiCredits: 500, resetDay: 1, warnAtPercent: 80 });
    writeFileSync(file(), JSON.stringify({ monthlyAllowance: "oops" }), "utf-8");
    expect(store.read()).toEqual(defaults);
  });

  it("round-trips a write across a reopened store, under the monthlyAllowance key", () => {
    new FileAllowanceSettingsStore(dir).write(valid);

    expect(new FileAllowanceSettingsStore(dir).read()).toEqual(valid);
    expect(JSON.parse(readFileSync(file(), "utf-8"))).toEqual({ monthlyAllowance: valid });
  });

  it("a null allowance keeps the reset day and the threshold", () => {
    const store = new FileAllowanceSettingsStore(dir);
    store.write({ ...valid, aiCredits: null });

    expect(store.read()).toEqual({ ...valid, aiCredits: null });
  });

  it("keeps other settings keys, in both write orders", () => {
    new FileAppSettingsStore(dir).writeActiveProviderId("pi");
    const store = new FileAllowanceSettingsStore(dir);
    store.write(valid);
    new FileAppSettingsStore(dir).writeMinRetainedSessionLogsThreshold(300);

    expect(new FileAppSettingsStore(dir).readActiveProviderId()).toBe("pi");
    expect(new FileAppSettingsStore(dir).readMinRetainedSessionLogsThreshold()).toBe(300);
    expect(store.read()).toEqual(valid);
  });

  it.each([
    ["over the cap", { ...valid, aiCredits: 1_000_000_001 }],
    ["zero", { ...valid, aiCredits: 0 }],
    ["reset day 29", { ...valid, resetDay: 29 }],
    ["reset day 0", { ...valid, resetDay: 0 }],
    ["warn percent 101", { ...valid, warnAtPercent: 101 }],
    ["warn percent 0", { ...valid, warnAtPercent: 0 }],
    ["fractional day", { ...valid, resetDay: 1.5 }],
    ["unknown key", { ...valid, extra: 1 }],
    ["missing field", { aiCredits: 5 }],
  ])("rejects %s and writes nothing", (_label, bad) => {
    const store = new FileAllowanceSettingsStore(dir);

    expect(() => store.write(bad as never)).toThrow();

    expect(nodeFs.existsSync(file())).toBe(false);
  });

  it("a failed write leaves the previous allowance readable", () => {
    new FileAllowanceSettingsStore(dir).write(valid);
    const failing = {
      ...nodeFs,
      renameSync: () => {
        throw new Error("boom");
      },
    };

    expect(() => new FileAllowanceSettingsStore(dir, failing).write({ ...valid, aiCredits: 7 })).toThrow("boom");

    expect(new FileAllowanceSettingsStore(dir).read()).toEqual(valid);
  });
});
