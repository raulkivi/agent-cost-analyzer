import type { LearnScenarioCatalog } from "./learn-scenario-catalog.js";
import {
  ScenarioNotFoundError,
  type LearnSimulationService,
} from "./learn-simulation-service.js";

// Lets ApiService's Learn list and lookup read simulated sessions through a
// narrow catalog interface (ISP) instead of the whole simulation service.
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
