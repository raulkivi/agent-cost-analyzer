import { existsSync } from "node:fs";
import { agentHostDbPath } from "../../data-sources/agent-host/agent-host-paths.js";

// Whether the Agent Host's session catalog exists, asked afresh on every
// call so a catalog created after startup is noticed without a restart.
export function agentHostCatalogProbe(userDataDir: string | null): () => boolean {
  return () => userDataDir !== null && existsSync(agentHostDbPath(userDataDir));
}
