// Regenerates the scenario docs' tables from the Learn simulator (step 13.9, D7).
//   npm run scenarios:docs          rewrite docs/scenarios/*.md
//   npm run scenarios:docs:check    list the docs that differ, exit 1 if any
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  SCENARIO_DOCS_DIR,
  compareScenarioDocs,
} from "../src/services/learn-simulation/scenario-docs/docs-io.ts";

const check = process.argv.includes("--check");
const drifted = compareScenarioDocs().filter(
  (pair) => pair.current !== pair.generated,
);

if (check) {
  if (drifted.length > 0) {
    console.error(
      "These scenario docs are out of date (run `npm run scenarios:docs`):",
    );
    for (const pair of drifted) console.error(`  docs/scenarios/${pair.file}`);
    process.exit(1);
  }
  console.log("Scenario docs are up to date.");
} else {
  for (const pair of drifted) {
    writeFileSync(path.join(SCENARIO_DOCS_DIR, pair.file), pair.generated);
    console.log(`updated docs/scenarios/${pair.file}`);
  }
  if (drifted.length === 0)
    console.log("Scenario docs were already up to date.");
}
