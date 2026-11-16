// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { existsSync } from "node:fs";
import type { ToolCallRecord, ToolCallStatus, ToolKind } from "@agent-cost-analyzer/domain";
import { readRecordLines } from "../../platform/files/read-record-lines.js";
import { MAX_ARGS_SUMMARY_LENGTH, summarizeToolArgs } from "../../services/tool-audit/args-summary.js";
import { buildToolCallOutcome } from "../../services/tool-audit/outcome-builder.js";
import { excerptOf } from "../../services/tool-audit/output-redactor.js";
import { parseShellCommand } from "../../services/tool-audit/shell-command-parser.js";
import { resolveToolKind } from "../../services/tool-audit/tool-kind-resolver.js";
import { projectAuditAttrs } from "./audit-attrs-projector.js";
import { parseEnvelopeLine, type JsonlEnvelope } from "./main-jsonl-reader.js";
import { groupEnvelopesByUserMessage } from "./session-usage-spans.js";

// Step 10.20 (plan §5.2, D3): a classic tool_call span as a ToolCallRecord,
// the same rule for the main agent and for subagent child logs.

export const UNRECOGNISED_STATUS_REASON = "unrecognized span status";

// D14: Copilot Chat records a user stop as status "error" with this text.
const CANCELED_TEXT = /^canceled$/i;

const SHELL_COMMAND_FIELD = /"command"\s*:\s*"((?:[^"\\]|\\.)*)/;

function parseArgs(args: string | undefined): unknown {
  if (args === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(args);
  } catch {
    // The projector cut a long argument string, so the JSON may be unclosed:
    // keep the bounded text, not nothing.
    return args;
  }
}

// A cut shell argument string no longer parses as JSON; its command field's
// opening text still reads.
function salvageCommand(args: string): string | undefined {
  const match = SHELL_COMMAND_FIELD.exec(args);
  if (!match?.[1]) {
    return undefined;
  }
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1].replace(/\\(["\\])/g, "$1");
  }
}

function shellCommandOf(args: string | undefined, parsed: unknown): string | undefined {
  if (typeof parsed === "object" && parsed !== null) {
    const command = (parsed as Record<string, unknown>).command;
    return typeof command === "string" && command.length > 0 ? command : undefined;
  }
  return args === undefined ? undefined : salvageCommand(args);
}

function statusOf(span: JsonlEnvelope, errorText: string): { status: ToolCallStatus; reason?: string } {
  if (span.status === "ok") {
    return { status: "success" };
  }
  if (span.status === "error") {
    return { status: CANCELED_TEXT.test(errorText.trim()) ? "canceled" : "error" };
  }
  return { status: "unknown", reason: UNRECOGNISED_STATUS_REASON };
}

export function toolCallSpanRecord(span: JsonlEnvelope): ToolCallRecord {
  const name = span.name ?? "unknown tool";
  const kind: ToolKind = resolveToolKind(name);
  const args = typeof span.attrs?.args === "string" ? span.attrs.args : undefined;
  const errorText = typeof span.attrs?.error === "string" ? span.attrs.error : "";
  const parsedArgs = parseArgs(args);
  const command = kind === "shell" ? shellCommandOf(args, parsedArgs) : undefined;
  const program = command === undefined ? undefined : parseShellCommand(command).program;
  const { status, reason } = statusOf(span, errorText);
  return {
    ...(span.spanId ? { id: span.spanId } : {}),
    name,
    kind,
    argsSummary: command !== undefined ? excerptOf(command, MAX_ARGS_SUMMARY_LENGTH) : summarizeToolArgs(kind, parsedArgs),
    ...(command !== undefined ? { shell: { command: excerptOf(command, MAX_ARGS_SUMMARY_LENGTH), ...(program ? { program } : {}) } } : {}),
    outcome: buildToolCallOutcome({ kind, status, text: errorText, ...(reason ? { reason } : {}) }),
    ...(typeof span.ts === "number" && Number.isFinite(span.ts) ? { startedAt: new Date(span.ts).toISOString() } : {}),
    ...(typeof span.dur === "number" && Number.isFinite(span.dur) ? { durationMs: span.dur } : {}),
  };
}

// Streams a debug log (main.jsonl or a child log) with the audit projector and
// returns, per user_message turn, that file's tool_call spans in order. A
// missing file is no turns.
export async function readToolCallRecordsByLogTurn(logPath: string): Promise<ToolCallRecord[][]> {
  if (!existsSync(logPath)) {
    return [];
  }
  const envelopes = await streamAuditEnvelopes(logPath);
  return groupEnvelopesByUserMessage(envelopes).map((group) =>
    group.filter((envelope) => envelope.type === "tool_call").map(toolCallSpanRecord),
  );
}

// A child log's tool_call spans in file order, whatever turn marker they follow
// (a run is one unit, not a session of turns). Rejects when the file can't be
// read, so a caller never takes an unreadable log for a run with no calls.
export async function readToolCallRecords(logPath: string): Promise<ToolCallRecord[]> {
  const envelopes = await streamAuditEnvelopes(logPath);
  return envelopes.filter((envelope) => envelope.type === "tool_call").map(toolCallSpanRecord);
}

async function streamAuditEnvelopes(logPath: string): Promise<JsonlEnvelope[]> {
  const envelopes: JsonlEnvelope[] = [];
  for await (const line of readRecordLines(logPath)) {
    const envelope = parseEnvelopeLine(line, projectAuditAttrs);
    if (envelope && (envelope.type === "user_message" || envelope.type === "tool_call")) {
      envelopes.push(envelope);
    }
  }
  return envelopes;
}
