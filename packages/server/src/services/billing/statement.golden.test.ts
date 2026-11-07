// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { exportStatement, statementAnswerSchema } from "@agent-cost-analyzer/domain";
import { FileStatementStore } from "../../data-sources/statements/file-statement-store.js";
import { DatasetCostCubeSource } from "../cost-analysis/cost-analysis-service.js";
import { composeCostFixture, fixtureProjects } from "../../test-support/cost-analysis-fixture.js";
import { PriceBook } from "../pricing/price-book.js";
import { BundledPriceBookSource } from "../pricing/bundled-price-book-source.js";
import { priceBookHashOf, StatementService } from "./statement-service.js";

// Phase 15 step 15.11 exit criterion (plan §14): golden statements over the
// fixture dataset (three providers, two projects, the bundled price book),
// committed under __golden__/ (update with `vitest -u` after checking the
// diff by hand), with their CSV and Markdown exports.

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const golden = (name: string) => `./__golden__/${name}`;

describe("statements over the fixture dataset (golden)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "statements-golden-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const { insights } = composeCostFixture();
  const service = new StatementService({
    cubes: new DatasetCostCubeSource(insights),
    store: new FileStatementStore(dir),
    projects: { load: () => ({ file: { ...fixtureProjects, version: 1, aliases: {}, captureRules: [] } }) },
    priceBookHash: () => priceBookHashOf(new PriceBook(new BundledPriceBookSource()).list({}).versions),
    appVersion: "0.0.0-test",
    timeZone: "UTC",
    now: () => new Date("2026-11-06T12:00:00.000Z"),
  });

  it("the portal project's October draft, and its exports", async () => {
    const answer = statementAnswerSchema.parse(await service.get({ projectId: "portal", period: "2026-10" }));
    await expect(json(answer)).toMatchFileSnapshot(golden("statement-portal-2026-10.json"));
    await expect(exportStatement(answer.statement, "csv")).toMatchFileSnapshot(golden("statement-portal-2026-10.csv"));
    await expect(exportStatement(answer.statement, "markdown")).toMatchFileSnapshot(golden("statement-portal-2026-10.md"));
    // Copilot billed 1 + 0.9 AI Credits; Claude Code's priced turns are API-equivalent, so left off (D4).
    expect(answer.statement.totals).toEqual([{ currency: "AI_CREDITS", lines: 1.9, markup: 0, fixed: 0, total: 1.9 }]);
    expect(answer.statement.excluded).toEqual([expect.objectContaining({ turns: 2 })]);
    expect(answer.canIssue).toEqual({ ok: true });
  });

  it("the billing project's October draft", async () => {
    const answer = statementAnswerSchema.parse(await service.get({ projectId: "billing", period: "2026-10" }));
    await expect(json(answer)).toMatchFileSnapshot(golden("statement-billing-2026-10.json"));
  });

  it("issues October for portal, and the frozen copy then matches its re-run exactly", async () => {
    const issued = await service.issue({ projectId: "portal", period: "2026-10" });
    const again = await service.get({ projectId: "portal", period: "2026-10" });
    expect(again?.statement).toEqual(issued.statement);
    expect(again?.diff?.changed).toBe(false);
  });
});
