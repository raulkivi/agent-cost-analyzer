import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { createAttrsProjector, parseEnvelopeLine, type JsonlEnvelope } from "./main-jsonl-reader.js";

// The wide-content attrs keys the narrow KNOWN_ATTRS_KEYS allow-list
// deliberately drops (main-jsonl-reader.ts's high-severity-finding fix) —
// only read here, on demand, for one turn's span at a time.
const WIDE_ATTRS_KEYS = [
  "content", // user_message
  "userRequest",
  "inputMessages", // llm_request
  "response",
  "reasoning", // agent_response
  "args",
  "result", // tool_call
] as const;

const projectWideAttrs = createAttrsProjector(WIDE_ATTRS_KEYS);

export interface TurnEnvelopesResult {
  turnEnvelopes: JsonlEnvelope[];
  previousInputMessagesLength: number;
}

// Confirmed against this machine's own real, unredacted main.jsonl:
// inputMessages is a JSON-*encoded string* of the message array, not a raw
// array — must be parsed before its length means anything.
function inputMessagesLength(envelope: JsonlEnvelope): number | null {
  const raw = envelope.attrs?.inputMessages;
  const parsed = typeof raw === "string" ? tryParseJson(raw) : raw;
  return Array.isArray(parsed) ? parsed.length : null;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Streams main.jsonl a second time (§4: a separate, on-demand path — the
// existing whole-session read path's KNOWN_ATTRS_KEYS allow-list stays
// unchanged), isolating only the envelopes belonging to the Nth
// user_message-to-user_message span (turnIndex is 0-based, same positional
// join groupEnvelopesByUserMessage already computes for the narrow path).
// Reading stops once that span ends, so memory stays bounded to one turn's
// content regardless of session length (§4/§5.4).
export async function readMainJsonlEnvelopesForTurn(
  filePath: string,
  turnIndex: number,
): Promise<TurnEnvelopesResult | null> {
  if (!existsSync(filePath)) {
    return null;
  }

  const turnEnvelopes: JsonlEnvelope[] = [];
  let userMessageCount = -1;
  let trackedInputMessagesLength = 0;
  let previousInputMessagesLength = 0;
  let foundTarget = false;

  const lines = createInterface({
    input: createReadStream(filePath, "utf-8"),
    crlfDelay: Infinity,
  });

  for await (const line of lines) {
    const envelope = parseEnvelopeLine(line, projectWideAttrs);
    if (!envelope) {
      continue;
    }

    if (envelope.type === "user_message") {
      userMessageCount += 1;
      if (userMessageCount === turnIndex + 1) {
        // The next span has started — stop reading rather than buffering
        // any of it.
        break;
      }
      if (userMessageCount === turnIndex) {
        foundTarget = true;
        previousInputMessagesLength = trackedInputMessagesLength;
        turnEnvelopes.push(envelope);
        continue;
      }
    }

    if (foundTarget && userMessageCount === turnIndex) {
      turnEnvelopes.push(envelope);
      continue;
    }

    if (!foundTarget && envelope.type === "llm_request") {
      // Only the most recent llm_request's inputMessages.length before the
      // target span is retained — O(1) memory regardless of how many
      // earlier turns exist, since only one number is ever kept.
      const length = inputMessagesLength(envelope);
      if (length !== null) {
        trackedInputMessagesLength = length;
      }
    }
  }

  return foundTarget ? { turnEnvelopes, previousInputMessagesLength } : null;
}
