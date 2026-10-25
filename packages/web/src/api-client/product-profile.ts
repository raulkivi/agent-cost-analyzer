import type { ProductProfile } from "@agent-cost-analyzer/domain";
import { getApiTransport } from "./current-transport.js";

// Which product the UI runs in (vscode-extension.md §3.3); the web app
// fetches it once at startup.
export function fetchProductProfile(): Promise<ProductProfile> {
  return getApiTransport().call<ProductProfile>("getProductProfile");
}
