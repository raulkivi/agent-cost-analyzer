import type { HostEventName } from "@agent-cost-analyzer/domain";
import { getApiTransport } from "./current-transport.js";

// Subscribes to a host-pushed event (e.g. configChanged -> re-fetch the
// config status) on the installed transport. Where the transport has no host
// to push anything — the standalone app's HTTP transport — it's a no-op, so
// callers never branch on which product they run in. Returns the
// unsubscribe function.
export function onHostEvent(name: HostEventName, handler: (payload: unknown) => void): () => void {
  return getApiTransport().onEvent?.(name, handler) ?? (() => undefined);
}
