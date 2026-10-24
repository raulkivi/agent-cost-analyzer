import { getApiTransport } from "./current-transport.js";

export interface HealthResponse {
  status: string;
  version: string;
}

export function fetchHealth(): Promise<HealthResponse> {
  return getApiTransport().call<HealthResponse>("getHealth");
}
