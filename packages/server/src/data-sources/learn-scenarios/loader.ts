import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  sessionSchema,
  sumTokenCounts,
  unavailableTokenCount,
  type Session,
  type TokenCount,
} from "@copilot-cost-analyzer/domain";

// Resolved only when no fixturesDir is injected (G4, vscode-extension.md
// §2.2): a single-file bundle has no usable import.meta.url, so it passes
// its own directory instead, and this must not run at import time.
function defaultFixturesDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/learn-scenarios");
}

const SCENARIO_COST_UNKNOWN_REASON =
  "AI Credits total is unavailable because at least one turn in this scenario has an unknown cost.";

// Fixtures don't carry a session-level costAiCredits — it's derived from
// each turn's already-required TurnUsage.costAiCredits, so authoring a
// fixture never means hand-computing (and risking a stale) running total.
function deriveScenarioCost(raw: unknown): TokenCount {
  const turns = (raw as { turns?: { usage?: { costAiCredits?: TokenCount } }[] }).turns ?? [];
  return sumTokenCounts(
    turns.map((turn) => turn.usage?.costAiCredits ?? unavailableTokenCount(SCENARIO_COST_UNKNOWN_REASON)),
    SCENARIO_COST_UNKNOWN_REASON,
  );
}

export interface LearnScenarioCatalog {
  list(): Session[];
  get(id: string): Session | undefined;
}

export interface LoadLearnScenariosOptions {
  fixturesDir?: string;
}

// Reads and validates every fixture once, up front — callers load the
// catalog at startup so an invalid bundled fixture still breaks startup.
export function loadLearnScenarios(options: LoadLearnScenariosOptions = {}): LearnScenarioCatalog {
  const fixturesDir = options.fixturesDir ?? defaultFixturesDir();
  const scenarios = new Map<string, Session>();
  const files = readdirSync(fixturesDir).filter((file) => file.endsWith(".json"));

  for (const file of files) {
    const raw: unknown = JSON.parse(readFileSync(path.join(fixturesDir, file), "utf-8"));
    // Fail fast: an invalid bundled fixture must break startup, not serve bad data.
    const scenario = sessionSchema.parse({
      ...(raw as object),
      costAiCredits: deriveScenarioCost(raw),
    });

    if (scenario.mode !== "learn") {
      throw new Error(`Learn scenario fixture "${file}" must have mode "learn"`);
    }
    if (scenarios.has(scenario.id)) {
      throw new Error(`Duplicate learn scenario id "${scenario.id}" (from "${file}")`);
    }
    scenarios.set(scenario.id, scenario);
  }

  return {
    list: () => Array.from(scenarios.values()),
    get: (id) => scenarios.get(id),
  };
}

let defaultCatalog: LearnScenarioCatalog | undefined;

function getDefaultCatalog(): LearnScenarioCatalog {
  defaultCatalog ??= loadLearnScenarios();
  return defaultCatalog;
}

// The bundled scenarios from the default fixtures directory, loaded on
// first use.
export function listLearnScenarios(): Session[] {
  return getDefaultCatalog().list();
}

export function getLearnScenario(id: string): Session | undefined {
  return getDefaultCatalog().get(id);
}
