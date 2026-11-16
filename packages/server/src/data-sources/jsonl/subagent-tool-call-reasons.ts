// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { MAX_SUBAGENT_FILES_PER_SESSION } from "./subagent-log-path.js";

// Step 10.20 (plan §6): why a subagent run's tool calls are unknown. Plain
// sentences, none embeds log text beyond the validated label: each reaches the
// UI and MCP tools as `AuditedRun.unreadReason`. The reasons for a log that is
// not a regular file, has a rejected name, can't be read or has no readable
// events stay 10.19's (subagent-attribution.ts).
export const missingSubagentLogReason = (label: string): string =>
  `The subagent log \`${label}\` this turn started is missing, so its tool calls are unknown.`;

export const TOO_MANY_SUBAGENT_LOGS_REASON =
  `There are too many subagent logs to read (more than ${MAX_SUBAGENT_FILES_PER_SESSION} in this session's folder), so the tool calls of this run are unknown.`;

export const NESTED_SUBAGENT_NOT_READ_REASON =
  "This run was started by another subagent run: nested subagents are not read, so its tool calls are unknown.";

export const UNLOGGED_SUBAGENT_TOOL_REASON =
  "A subagent tool was called, but this subagent tool writes no log the analyzer reads, so the tool calls of its run are unknown.";

export const BEYOND_READ_DEPTH_REASON =
  "This run is nested in a cycle or deeper than the analyzer follows: nested subagents beyond the read depth are not read, so its tool calls are unknown.";
