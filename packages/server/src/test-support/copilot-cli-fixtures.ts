import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentHostTurnEventRef } from "../data-sources/agent-host/agent-session-store.js";
import {
  readAgentHostFixtureRows,
  writeAgentHostCatalog,
  writeAgentSessionDb,
  type AgentHostTableRows,
} from "./agent-host-user-data-dir.js";

// The Copilot CLI fixtures of step 10.14 (fixtures/agent-host/copilot-cli/,
// see its README) wired into Agent Host stores: a catalog whose sessions own
// the fixture's chats_v2 rows, and a session.db per session whose turns
// carry the fixture's event ids. The fixture dir itself is the Copilot home.

export const COPILOT_CLI_FIXTURE_HOME = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/agent-host/copilot-cli",
);

export type CopilotCliFixtureName = "normal" | "steeringAbortSubagent" | "systemPromptReemit" | "malformed" | "missingLog";

interface CopilotCliFixtureRows {
  sdkSessionIds: Record<CopilotCliFixtureName, string>;
  chats_v2: Record<string, unknown>[];
  turns: Record<CopilotCliFixtureName | "unmatched", { id: string; event_id: string | null; checkpoint_ref: string }[]>;
}

export const copilotCliFixtureRows = JSON.parse(
  readFileSync(path.join(COPILOT_CLI_FIXTURE_HOME, "rows.json"), "utf8"),
) as CopilotCliFixtureRows;

// The Agent Host session that owns each fixture log (chats_v2.owner_session_uri).
export const COPILOT_CLI_FIXTURE_SESSION_IDS: Record<CopilotCliFixtureName, string> = {
  normal: "9a1b2c3d-5555-4e6f-8a07-000000000001",
  steeringAbortSubagent: "9a1b2c3d-5555-4e6f-8a07-000000000002",
  systemPromptReemit: "9a1b2c3d-5555-4e6f-8a07-000000000003",
  malformed: "9a1b2c3d-5555-4e6f-8a07-000000000004",
  missingLog: "9a1b2c3d-5555-4e6f-8a07-000000000005",
};

const FIXTURE_NAMES = Object.keys(COPILOT_CLI_FIXTURE_SESSION_IDS) as CopilotCliFixtureName[];

// The missing-log session gets the turns no log matches, so it is listed.
function turnRowsOf(name: CopilotCliFixtureName) {
  return copilotCliFixtureRows.turns[name === "missingLog" ? "unmatched" : name];
}

export function copilotCliFixtureTurnRefs(name: CopilotCliFixtureName): AgentHostTurnEventRef[] {
  return turnRowsOf(name).map((row) => ({ turnId: row.id, eventId: row.event_id }));
}

// Each fixture session as a catalog row, newest last, cloned from the 10.13
// catalog fixture's first session.
function catalogRows(): AgentHostTableRows {
  const template = readAgentHostFixtureRows("catalog-rows.json").sessions_v2[0]!;
  return {
    sessions_v2: FIXTURE_NAMES.map((name, index) => ({
      ...template,
      session_uri: `copilotcli:/${COPILOT_CLI_FIXTURE_SESSION_IDS[name]}`,
      start_time: (template.start_time as number) + index * 60_000,
    })),
    chats_v2: copilotCliFixtureRows.chats_v2,
  };
}

// Every turn gets the 10.13 fixture's first usage row, so tokens and AI
// Credits are known and the event log only adds text and tool calls.
function sessionRows(name: CopilotCliFixtureName): AgentHostTableRows {
  const usage = readAgentHostFixtureRows("session-rows.json").turn_usage[0]!.usage;
  const turns = turnRowsOf(name);
  return { turns, turn_usage: turns.map((turn) => ({ turn_id: turn.id, usage })) };
}

export function writeCopilotCliAgentHostStores(userDataDir: string): void {
  writeAgentHostCatalog(userDataDir, catalogRows());
  for (const name of FIXTURE_NAMES) {
    writeAgentSessionDb(userDataDir, COPILOT_CLI_FIXTURE_SESSION_IDS[name], sessionRows(name));
  }
}
