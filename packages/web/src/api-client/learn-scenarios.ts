import type { Session } from "@copilot-cost-analyzer/domain";
import { getApiTransport } from "./current-transport.js";

export function fetchLearnScenarios(): Promise<Session[]> {
  return getApiTransport().call<Session[]>("listLearnScenarios");
}

export function fetchLearnScenario(id: string): Promise<Session> {
  return getApiTransport().call<Session>("getLearnScenario", { id });
}
