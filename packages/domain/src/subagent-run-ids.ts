// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";

// One home for the run id and label patterns, so the cost side
// (`turn-usage.ts`) and the audit side (`tool-call-origin.ts`) cannot drift.
// Both come from a log file and reach the UI and MCP tools, hence the caps.
export const subagentRunIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

// Copilot classic: runSubagent-<name> / searchSubagent. Claude Code (step
// CS4): the tool name `Agent`, with the `agentType` after a hyphen. Agent Host
// (step 10.20): `task-<agentName>` or `search_code_subagent`.
export const subagentLabelSchema = z
  .string()
  .regex(/^(runSubagent-[A-Za-z0-9_ -]{1,64}|searchSubagent|Agent(-[A-Za-z0-9_.: -]{1,64})?|task(-[A-Za-z0-9_.: -]{1,64})?|search_code_subagent)$/);
