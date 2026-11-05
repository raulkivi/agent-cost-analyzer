import type { LearnScenarioCatalog } from "../../data-sources/learn-scenarios/loader.js";
import {
  ScenarioNotFoundError,
  type LearnSimulationService,
} from "./learn-simulation-service.js";

// Lets ApiService's Learn list and lookup read simulated sessions through the
// same catalog interface the fixture loader implements, so ApiService needs
// no change for the extension (OCP).
export function createSimulatedScenarioCatalog(
  simulation: Pick<LearnSimulationService, "listScenarios" | "getScenario">,
): LearnScenarioCatalog {
  return {
    list: () => simulation.listScenarios(),
    get: (id) => {
      try {
        return simulation.getScenario(id);
      } catch (error) {
        if (error instanceof ScenarioNotFoundError) return undefined;
        throw error;
      }
    },
  };
}
