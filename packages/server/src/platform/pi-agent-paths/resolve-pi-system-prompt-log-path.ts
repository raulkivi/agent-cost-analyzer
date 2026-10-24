import { homedir } from "node:os";
import path from "node:path";

interface ResolvePiSystemPromptLogPathOptions {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

// The sidecar JSONL log packages/pi-system-prompt-logger (an optional,
// separately-installed pi extension) writes to, one line per captured
// session. Unlike resolvePiAgentSessionsDir, this never checks existsSync —
// the file legitimately may not exist yet (extension not installed, or no
// session captured yet), and that's a normal state the sidecar reader
// already handles (an empty index), not a misconfiguration to report.
export function resolvePiSystemPromptLogPath(
  options: ResolvePiSystemPromptLogPathOptions = {},
): string {
  const env = options.env ?? process.env;
  if (env.PI_SYSTEM_PROMPT_LOG_PATH) {
    return env.PI_SYSTEM_PROMPT_LOG_PATH;
  }
  const homeDir = options.homeDir ?? homedir();
  return path.join(homeDir, ".pi", "agent", "logs", "system-prompts.jsonl");
}
