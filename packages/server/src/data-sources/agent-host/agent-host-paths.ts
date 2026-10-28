import path from "node:path";

// The VS Code Agent Host's session catalog, in VS Code's
// user-data dir, beside the extensions' globalStorage.
export function agentHostDbPath(userDataDir: string, pathApi: path.PlatformPath = path): string {
  return pathApi.join(userDataDir, "User", "globalStorage", "agent-host.db");
}

// Session ids are file-safe by construction in the agent host; anything else
// could escape agentSessionData/ via traversal once joined, so reject it.
const SESSION_ID_PATTERN = /^[0-9A-Za-z][0-9A-Za-z-]*$/;

// The per-session db the agent host keeps outside the catalog, or null when
// the caller handed us an unusable id.
export function agentSessionDbPath(
  userDataDir: string,
  sessionId: string,
  pathApi: path.PlatformPath = path,
): string | null {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return null;
  }
  return pathApi.join(userDataDir, "agentSessionData", sessionId, "session.db");
}
