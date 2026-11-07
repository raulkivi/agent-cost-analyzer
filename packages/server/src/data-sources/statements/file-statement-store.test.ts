// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseStatementPeriod, type Statement } from "@agent-cost-analyzer/domain";
import { billed, costs, cubeOf, cubeRow } from "../../test-support/cost-cube-fakes.js";
import { buildStatement } from "../../services/billing/statement-builder.js";
import { FileStatementStore, StatementAlreadyIssuedError } from "./file-statement-store.js";

// Phase 15 step 15.11 (plan §8.5): issued statements as JSON in the app's
// settings folder, statements/<project>/<period>.json. A frozen statement
// is never overwritten.

function sampleStatement(overrides: Partial<Statement> = {}): Statement {
  const cube = cubeOf([cubeRow({ date: "2026-10-05", at: "2026-10-05T10:00:00Z", projectId: "portal", cost: costs({ billed: billed(10) }) })]);
  const draft = buildStatement(cube, {
    project: { id: "portal", name: "Portal", members: [{ repository: "github.com/acme/portal" }] },
    period: parseStatementPeriod("2026-10", "UTC")!,
    generatedAt: "2026-11-06T12:00:00.000Z",
    appVersion: "0.0.0-test",
    priceBookHash: "pb",
    projectsFileHash: "pf",
  });
  return { ...draft, ...overrides };
}

describe("FileStatementStore", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "statements-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const issued = sampleStatement({ status: "issued", issuedAt: "2026-11-02T09:00:00.000Z" });

  it("writes an issued statement where the plan says, readable only by the user, and reads it back", () => {
    const store = new FileStatementStore(dir);
    store.write(issued);
    const file = path.join(dir, "statements", "portal", "2026-10.json");
    expect(JSON.parse(readFileSync(file, "utf-8"))).toEqual(issued);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(store.read("portal", "2026-10")).toEqual(issued);
    expect(store.list("portal")).toEqual(["2026-10"]);
  });

  it("never overwrites a frozen statement", () => {
    const store = new FileStatementStore(dir);
    store.write(issued);
    expect(() => store.write({ ...issued, issuedAt: "2026-11-03T09:00:00.000Z" })).toThrow(StatementAlreadyIssuedError);
    expect(store.read("portal", "2026-10")?.issuedAt).toBe("2026-11-02T09:00:00.000Z");
  });

  it("gives nothing for a period not issued, and an empty list for a project with none", () => {
    const store = new FileStatementStore(dir);
    expect(store.read("portal", "2026-09")).toBeUndefined();
    expect(store.list("portal")).toEqual([]);
  });

  it("refuses a draft, and ids or keys that could leave the folder", () => {
    const store = new FileStatementStore(dir);
    expect(() => store.write(sampleStatement())).toThrow(/issued/);
    expect(() => store.read("../x", "2026-10")).toThrow();
    expect(() => store.read("portal", "../../etc")).toThrow();
  });

  it("refuses a file that is not a valid statement rather than trusting it", () => {
    const store = new FileStatementStore(dir);
    store.write(issued);
    writeFileSync(path.join(dir, "statements", "portal", "2026-10.json"), '{"version":1}');
    expect(() => store.read("portal", "2026-10")).toThrow(/not a valid statement/);
  });
});
