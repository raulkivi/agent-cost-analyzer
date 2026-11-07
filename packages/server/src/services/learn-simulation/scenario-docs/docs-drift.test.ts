// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SCENARIO_FILES } from "./generate-docs.js";
import { SCENARIO_DOCS_DIR, compareScenarioDocs } from "./docs-io.js";

// D7: the scenario docs' numbers come from the simulator. A failing test
// means a script, a price or a rule changed: run `npm run scenarios:docs`
// and review the diff.
describe("scenario docs", () => {
  const pairs = compareScenarioDocs();

  for (const pair of pairs) {
    it(`${pair.file} matches what the simulator generates`, () => {
      expect(pair.current).toBe(pair.generated);
    });
  }

  // The prose around the generated tables must not quote absolute figures:
  // they would go stale the next time a price changes.
  const QUOTED_FIGURE =
    /\d,\d{3}|\b\d{4,}\b|\d\.\d{2,}|\bModel [AB]\b|`model-[ab]`/;
  for (const { file } of SCENARIO_FILES) {
    it(`${file} quotes no absolute token or credit figures in its prose`, () => {
      const doc = readFileSync(path.join(SCENARIO_DOCS_DIR, file), "utf-8");
      const prose = doc
        .replace(
          /<!-- scenarios:generated:start -->[\s\S]*?<!-- scenarios:generated:end -->/,
          "",
        )
        .split("\n")
        // links and the sources list carry dates and anchors, not figures
        .filter(
          (line) =>
            !line.includes("](") &&
            !/^- \[/.test(line) &&
            !line.startsWith("**Sources**"),
        );
      expect(prose.filter((line) => QUOTED_FIGURE.test(line))).toEqual([]);
    });
  }
});
