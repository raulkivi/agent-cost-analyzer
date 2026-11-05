import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadScenarioScripts } from "../../../data-sources/learn-scripts/loader.js";
import { loadVendorProfiles } from "../../../data-sources/vendor-profiles/loader.js";
import {
  ALL_SCENARIOS_FILE,
  SCENARIO_FILES,
  generateScenarioDocs,
} from "./generate-docs.js";

// Step 13.9 (D7): every scenario doc is simulated on this model.
export const REFERENCE_MODEL_ID = "claude-sonnet-5.5";
export const REFERENCE_VENDOR_ID = "anthropic";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../../../..");
export const SCENARIO_DOCS_DIR = path.join(repoRoot, "docs", "scenarios");

export interface DocPair {
  file: string;
  current: string;
  generated: string;
}

// The committed docs next to what the simulator generates for them now.
export function compareScenarioDocs(
  docsDir: string = SCENARIO_DOCS_DIR,
): DocPair[] {
  const files = [
    ...SCENARIO_FILES.map((entry) => entry.file),
    ALL_SCENARIOS_FILE,
  ];
  const docs = Object.fromEntries(
    files.map((file) => [
      file,
      readFileSync(path.join(docsDir, file), "utf-8"),
    ]),
  );
  const profile = loadVendorProfiles().find(
    (p) => p.vendorId === REFERENCE_VENDOR_ID,
  );
  if (profile === undefined)
    throw new Error(`No ${REFERENCE_VENDOR_ID} vendor profile`);
  const generated = generateScenarioDocs({
    docs,
    scripts: loadScenarioScripts(),
    profile,
    modelId: REFERENCE_MODEL_ID,
  });
  return files.map((file) => ({
    file,
    current: docs[file]!,
    generated: generated[file]!,
  }));
}
