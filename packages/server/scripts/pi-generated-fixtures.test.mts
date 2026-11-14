// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// CI check of the committed output of generate-pi-fixtures.mts: each
// manifest says which pi made the fixtures, and every file it lists parses
// to the counts it records and is redacted. No model runs here.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { countSession, type ManifestScenario, SCENARIOS } from "./generate-pi-fixtures-lib.mjs";

const generatedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/pi-agent/generated");

interface Manifest {
  piVersion: string;
  model: { provider: string; id: string };
  variant: string;
  generatedOn: string;
  idleSeconds: number;
  scenarios: ManifestScenario[];
}

// The default variant is required; the Gondolin one is optional.
const variants = [
  { variant: "default", dir: generatedDir },
  { variant: "gondolin", dir: path.join(generatedDir, "gondolin") },
].filter((v) => v.variant === "default" || existsSync(path.join(v.dir, "manifest.json")));

describe.each(variants)("generated pi fixtures manifest ($variant)", ({ variant, dir }) => {
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as Manifest;
  const files = manifest.scenarios.flatMap((s) => s.files);

  it("records the pi version, model, variant and date", () => {
    expect(manifest.piVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(manifest.model.provider).not.toBe("");
    expect(manifest.model.id).not.toBe("");
    expect(manifest.variant).toBe(variant);
    expect(manifest.generatedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("covers every scenario, all ok, with the full idle gap", () => {
    expect(manifest.scenarios.map((s) => s.id)).toEqual(Object.keys(SCENARIOS));
    expect(manifest.scenarios.every((s) => s.status === "ok")).toBe(true);
    expect(manifest.idleSeconds).toBeGreaterThan(300);
  });

  it("holds no paths or usernames", () => {
    expect(JSON.stringify(manifest)).not.toMatch(/\/home\/|\/tmp\/|\/Users\//);
  });

  it.each(files.map((f) => [f.file, f] as const))("%s parses to the recorded counts", (_name, file) => {
    const text = readFileSync(path.join(dir, file.file), "utf8");
    expect(countSession(text)).toEqual(file.counts);
    expect(file.counts.malformedLines).toBe(0);
    if (file.sidecar) {
      const records = readFileSync(path.join(dir, file.sidecar), "utf8").trim().split("\n");
      expect(records).toHaveLength(file.sidecarRecords);
      records.forEach((line) => expect(() => JSON.parse(line) as unknown).not.toThrow());
    }
  });

  it.each(files.map((f) => f.file))("%s is redacted: placeholder paths only", (name) => {
    const text = readFileSync(path.join(dir, name), "utf8");
    const sidecar = path.join(dir, name.replace(/\.jsonl$/, ".system-prompts.jsonl"));
    const all = text + (existsSync(sidecar) ? readFileSync(sidecar, "utf8") : "");
    expect(all).not.toMatch(/\/tmp\/|pi-fixtures-/);
    for (const home of all.match(/\/home\/[^/"\s\\]+/g) ?? []) expect(home).toBe("/home/user");
  });
});
