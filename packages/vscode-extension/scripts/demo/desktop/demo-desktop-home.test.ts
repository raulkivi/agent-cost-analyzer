// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CandidatePriceModelMapper } from "../../../../server/src/services/pricing/price-model-mapper.ts";
import { BundledPriceBookSource } from "../../../../server/src/services/pricing/bundled-price-book-source.ts";
import { PriceBook } from "../../../../server/src/services/pricing/price-book.ts";
import { createDemoDesktopHome, DEMO_COPILOT_MODELS } from "./demo-desktop-home.mts";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? files(file) : [file];
  });
}

describe("createDemoDesktopHome", () => {
  let root: string;
  let home: string;
  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "aica-demo-home-"));
    home = path.join(root, "home");
    createDemoDesktopHome(home);
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("leaves no fixture model name anywhere under the home", () => {
    const offenders = files(home).filter((file) => readFileSync(file).includes("fixture-"));
    expect(offenders).toEqual([]);
  });

  it("writes each realistic model name where the fixture's name was", () => {
    const text = files(home)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    for (const model of Object.values(DEMO_COPILOT_MODELS)) expect(text).toContain(`"model":"${model}"`);
  });

  it("uses model ids the github-copilot price book prices", () => {
    const mapper = new CandidatePriceModelMapper(new PriceBook(new BundledPriceBookSource()));
    for (const model of Object.values(DEMO_COPILOT_MODELS)) {
      expect(mapper.priceModelFor("github-copilot", model)).toEqual({ known: true, modelId: model });
    }
  });

  it("returns the fixture home's layout", () => {
    expect(createDemoDesktopHome(path.join(root, "second")).folders.portalWeb).toBe(path.join(root, "second", "dev", "portal-web"));
  });
});
