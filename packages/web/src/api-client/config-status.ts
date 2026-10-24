import type { ConfigStatus } from "@copilot-cost-analyzer/domain";
import { getApiTransport } from "./current-transport.js";

export function fetchConfigStatus(): Promise<ConfigStatus> {
  return getApiTransport().call<ConfigStatus>("getConfigStatus");
}

export function updateRetentionThreshold(value: number): Promise<ConfigStatus> {
  return getApiTransport().call<ConfigStatus>("setRetentionThreshold", { value });
}
