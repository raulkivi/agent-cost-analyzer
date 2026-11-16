// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const themeCss = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../theme.css"), "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");

// jsdom does no layout, so the 1440 px crowding rule of the owner's decision 2
// (2026-11-15) is pinned in the stylesheet; MS8's Playwright spec measures it
// in a real browser.
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(themeCss);
  expect(match, `rule ${selector}`).not.toBeNull();
  return match?.[2] ?? "";
}

describe("the header's allowance CSS", () => {
  it("caps the Source select at 150 px and truncates it with an ellipsis", () => {
    const body = rule(".nav--allowance .nav-field select");
    expect(body).toContain("max-width: 150px");
    expect(body).toContain("text-overflow: ellipsis");
  });

  it("lets the server status text shrink and truncate first", () => {
    const body = rule(".nav--allowance .app-status--inline");
    expect(body).toContain("min-width: 0");
    expect(body).toContain("text-overflow: ellipsis");
  });

  it("lets the gauge take the whole row at the narrow layout, wrapping its figure", () => {
    expect(rule(".allowance-gauge--narrow")).toContain("flex: 1 1 100%");
    expect(rule(".allowance-gauge--narrow .allowance-gauge-text")).toContain("white-space: normal");
  });

  it("draws the meter with existing roles only", () => {
    expect(rule(".allowance-meter--near")).toContain("--color-status-interrupted");
    expect(rule(".allowance-meter--over")).toContain("--color-status-error");
  });
});
