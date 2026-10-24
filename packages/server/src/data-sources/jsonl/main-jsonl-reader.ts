import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";

// Generic envelope shape (architecture.md §7). Only `type` is relied on by
// this adapter; everything else is intentionally optional/untyped since the
// `attrs` shape is undocumented and varies by event type/provider.
export interface JsonlEnvelope {
  v?: number;
  ts?: number;
  dur?: number;
  sid?: string;
  spanId?: string;
  type: string;
  name?: string;
  status?: string;
  attrs?: Record<string, unknown>;
}

// Every `attrs` key any extractor in this codebase reads (llm-request-
// extractor.ts's inputTokens/outputTokens/cachedTokens/copilotUsageNanoAiu/model/
// responseId, app.ts's systemPromptFile/toolsFile, system-prompt-breakdown.ts's
// details).
// `attrs` is otherwise an undocumented, per-provider payload that can carry
// arbitrarily large content (raw prompt/tool-call data) nothing here reads
// — a 2026-08-08 code/security review's high finding. Dropping
// unrecognized keys at parse time keeps memory bounded by what's actually
// used instead of the raw log's full per-line payload.
const KNOWN_ATTRS_KEYS = [
  "inputTokens",
  "outputTokens",
  "cachedTokens",
  "copilotUsageNanoAiu",
  "model",
  "responseId",
  "systemPromptFile",
  "toolsFile",
  "details",
] as const;

export type AttrsProjector = (attrs: unknown) => Record<string, unknown> | undefined;

// Factory rather than one fixed function so a second read path (turn-
// inspector-reader.ts) can keep its own allow-list without duplicating this
// key-filtering logic — only the key list differs between paths.
export function createAttrsProjector(keys: readonly string[]): AttrsProjector {
  return (attrs: unknown) => {
    if (typeof attrs !== "object" || attrs === null) {
      return undefined;
    }

    const source = attrs as Record<string, unknown>;
    const projected: Record<string, unknown> = {};
    let hasKnownKey = false;
    for (const key of keys) {
      if (key in source) {
        projected[key] = source[key];
        hasKnownKey = true;
      }
    }

    return hasKnownKey ? projected : undefined;
  };
}

const projectAttrs = createAttrsProjector(KNOWN_ATTRS_KEYS);

// Exported so turn-inspector-reader.ts's bounded wide-attrs read can reuse
// this line-parsing/JSON-shape logic with a different attrsProjector instead
// of duplicating it.
export function parseEnvelopeLine(
  line: string,
  attrsProjector: AttrsProjector = projectAttrs,
): JsonlEnvelope | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { type?: unknown }).type === "string"
    ) {
      const envelope = parsed as JsonlEnvelope;
      return { ...envelope, attrs: attrsProjector(envelope.attrs) };
    }
    return null;
  } catch {
    return null;
  }
}

export interface MainJsonlReadResult {
  envelopes: JsonlEnvelope[];
  // Non-blank raw lines seen, independent of whether they parsed into an
  // envelope — the signal classifyEnvelopesAvailability needs to tell a
  // truly-empty/session_start-only log apart from a non-trivial log that
  // failed to parse (a 2026-08-08 code/security review's medium finding).
  rawLineCount: number;
}

// Streams the file line-by-line (never buffers the whole log at once,
// per §11.1) and defensively parses each line into an envelope. Malformed
// or unrecognizable lines are skipped, not treated as errors (§7), but are
// still counted in rawLineCount.
export async function readMainJsonlFile(
  filePath: string,
): Promise<MainJsonlReadResult> {
  if (!existsSync(filePath)) {
    return { envelopes: [], rawLineCount: 0 };
  }

  const envelopes: JsonlEnvelope[] = [];
  let rawLineCount = 0;
  const lines = createInterface({
    input: createReadStream(filePath, "utf-8"),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    rawLineCount += 1;

    const envelope = parseEnvelopeLine(line);
    if (envelope) {
      envelopes.push(envelope);
    }
  }

  return { envelopes, rawLineCount };
}

export async function readMainJsonlEnvelopes(
  filePath: string,
): Promise<JsonlEnvelope[]> {
  return (await readMainJsonlFile(filePath)).envelopes;
}

export type MainJsonlAvailability =
  | "missing"
  | "logging-never-enabled"
  | "events-present"
  | "parse-failures";

// Cheap gating check (§7): a session's main.jsonl containing at most the
// single session_start line means logging was never enabled while it ran —
// the expected default case (constraint 8), not an error. A log with
// several raw lines that still produced at most one envelope is a
// different, non-actionable case ("parse-failures") — the setting was very
// likely on, but something else (parser regression, truncated/corrupted
// file) meant nothing could be extracted; conflating it with
// "logging-never-enabled" would tell the user to flip a setting that's
// probably already on. Pure/sync so a caller that already has the parsed
// envelopes (e.g. to also run the extractor registry on them) doesn't need
// to read the file twice.
export function classifyEnvelopesAvailability(
  envelopes: JsonlEnvelope[],
  rawLineCount: number,
): MainJsonlAvailability {
  if (envelopes.length > 1) {
    return "events-present";
  }
  // A raw line that didn't turn into an envelope (rawLineCount exceeds
  // envelopes.length) means something failed to parse, even if that's the
  // very first line — e.g. one corrupted line (rawLineCount 1, envelopes 0)
  // is "parse-failures", not "logging-never-enabled".
  return rawLineCount > envelopes.length ? "parse-failures" : "logging-never-enabled";
}

export async function classifyMainJsonlAvailability(
  filePath: string,
): Promise<MainJsonlAvailability> {
  if (!existsSync(filePath)) {
    return "missing";
  }

  const { envelopes, rawLineCount } = await readMainJsonlFile(filePath);
  return classifyEnvelopesAvailability(envelopes, rawLineCount);
}
