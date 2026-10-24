import type { AuditRollup, SessionAudit } from "@copilot-cost-analyzer/domain";
import { getApiTransport } from "./current-transport.js";

export interface RollupQuery {
  since?: string;
  until?: string;
  limit?: number;
}

export function fetchSessionAudit(sessionId: string): Promise<SessionAudit> {
  return getApiTransport().call<SessionAudit>("getSessionAudit", { sessionId });
}

// Unset / empty filters are dropped by the transport.
export function fetchAuditRollup(query: RollupQuery): Promise<AuditRollup> {
  return getApiTransport().call<AuditRollup>("getAuditRollup", query);
}
