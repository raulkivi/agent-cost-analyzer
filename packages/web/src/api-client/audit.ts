import type { AuditRollup, SessionAudit } from "@copilot-cost-analyzer/domain";
import { getApiTransport } from "./current-transport.js";

export interface RollupQuery {
  since?: string;
  until?: string;
  limit?: number;
}

export function fetchSessionAudit(sessionId: string, signal?: AbortSignal): Promise<SessionAudit> {
  return getApiTransport().call<SessionAudit>("getSessionAudit", { sessionId }, signal);
}

// Unset / empty filters are dropped by the transport. `signal` cancels the load.
export function fetchAuditRollup(query: RollupQuery, signal?: AbortSignal): Promise<AuditRollup> {
  return getApiTransport().call<AuditRollup>("getAuditRollup", query, signal);
}
