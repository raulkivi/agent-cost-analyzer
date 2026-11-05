import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  scenarioScriptSchema,
  type ScenarioScript,
} from "@agent-cost-analyzer/domain";

// Resolved lazily: a single-file bundle passes its own directory instead (G4).
function defaultScriptsDir(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../fixtures/learn-scripts",
  );
}

// Fail fast, like the other bundled-data loaders: an invalid script must
// break startup rather than feed a wrong simulation.
export function loadScenarioScripts(
  dir: string = defaultScriptsDir(),
): ScenarioScript[] {
  const scripts: ScenarioScript[] = [];
  const seen = new Map<string, string>();
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort();
  for (const file of files) {
    const raw: unknown = JSON.parse(
      readFileSync(path.join(dir, file), "utf-8"),
    );
    const parsed = scenarioScriptSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `Scenario script "${file}" is invalid: ${parsed.error.message}`,
      );
    }
    const first = seen.get(parsed.data.id);
    if (first !== undefined) {
      throw new Error(
        `Scenario script "${file}": duplicate id "${parsed.data.id}" (also in "${first}")`,
      );
    }
    seen.set(parsed.data.id, file);
    scripts.push(parsed.data);
  }
  return scripts;
}
