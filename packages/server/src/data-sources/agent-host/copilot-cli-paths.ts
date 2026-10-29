import os from "node:os";
import path from "node:path";

// Same rule as agent-host-paths.ts: the id is joined into a path, so anything
// that could escape session-state/<id> is rejected here.
const SDK_SESSION_ID_PATTERN = /^[0-9A-Za-z][0-9A-Za-z-]*$/;

// Mirrors the Copilot SDK's own resolution order so the log is found where the
// CLI wrote it. Whitespace-only counts as unset: a blank home would resolve the
// log against the working directory.
export function resolveCopilotHome(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
  pathApi: path.PlatformPath = path,
): string {
  const configured = env.COPILOT_HOME;
  if (typeof configured === "string" && configured.trim() !== "") {
    // Returned untrimmed: a path with surrounding spaces is still that path.
    return configured;
  }
  return pathApi.join(homedir(), ".copilot");
}

// The per-session event log the Copilot CLI appends to, or null when the id is
// unusable.
export function copilotEventLogPath(
  copilotHome: string,
  sdkSessionId: string,
  pathApi: path.PlatformPath = path,
): string | null {
  if (!SDK_SESSION_ID_PATTERN.test(sdkSessionId)) {
    return null;
  }
  return pathApi.join(copilotHome, "session-state", sdkSessionId, "events.jsonl");
}
