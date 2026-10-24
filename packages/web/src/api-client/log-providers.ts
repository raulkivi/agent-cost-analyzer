import type { LogProviderStatus } from "@copilot-cost-analyzer/domain";
import { getApiTransport } from "./current-transport.js";

export function fetchLogProviderStatus(): Promise<LogProviderStatus> {
  return getApiTransport().call<LogProviderStatus>("getLogProviderStatus");
}

export function setActiveLogProvider(id: string): Promise<LogProviderStatus> {
  return getApiTransport().call<LogProviderStatus>("setActiveLogProvider", { id });
}
