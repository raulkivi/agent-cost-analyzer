import type { Session, TurnInspectorDetail } from "@copilot-cost-analyzer/domain";
import { getApiTransport } from "./current-transport.js";

export function fetchSessions(): Promise<Session[]> {
  return getApiTransport().call<Session[]>("listSessions");
}

export function fetchSession(id: string): Promise<Session> {
  return getApiTransport().call<Session>("getSession", { id });
}

// The standalone server's raw-text route, useful on its own (e.g. opened
// directly by the browser for a raw view). The in-app inspector goes through
// fetchSystemPromptText so it also works over the webview transport.
export function systemPromptTextUrl(id: string): string {
  return `/api/sessions/${id}/system-prompt`;
}

export function fetchSystemPromptText(id: string): Promise<string> {
  return getApiTransport().call<string>("getSystemPromptText", { id });
}

export function fetchTurnInspectorDetail(sessionId: string, turnIndex: number): Promise<TurnInspectorDetail> {
  return getApiTransport().call<TurnInspectorDetail>("getTurnDetail", { sessionId, turnIndex });
}
