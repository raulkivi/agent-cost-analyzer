// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// The URI schemes a Copilot CLI session's agent-host.db rows are keyed by, in
// preference order. VS Code keys the session by its storage URI,
// copilotcli:/<id>; a run of VS Code Insiders builds keyed it by the Agent
// Host Protocol's runtime URI, ahp-session:/<id>, instead. VS Code's
// sessionStorageIdentity metadata pairs the two with the same id, so both
// name one session.
export const AGENT_HOST_SESSION_URI_SCHEMES = ["copilotcli", "ahp-session"] as const;

export interface ParsedAgentHostSessionUri {
  /** the URI without its scheme prefix */
  id: string;
  /** the scheme's index in AGENT_HOST_SESSION_URI_SCHEMES; lower wins */
  preference: number;
}

const PREFIXES = AGENT_HOST_SESSION_URI_SCHEMES.map((scheme) => `${scheme}:/`);

// null for any other scheme, and for an empty id, which names no session.
export function parseAgentHostSessionUri(sessionUri: string): ParsedAgentHostSessionUri | null {
  const preference = PREFIXES.findIndex((prefix) => sessionUri.startsWith(prefix));
  if (preference === -1) {
    return null;
  }
  const id = sessionUri.slice(PREFIXES[preference]!.length);
  return id === "" ? null : { id, preference };
}

// Every URI the session `id` can be cataloged under, in preference order.
export function agentHostSessionUrisOf(id: string): string[] {
  return id === "" ? [] : PREFIXES.map((prefix) => prefix + id);
}
