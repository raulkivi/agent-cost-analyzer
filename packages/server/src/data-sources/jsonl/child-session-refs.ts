// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { JsonlEnvelope } from "./main-jsonl-reader.js";

// One `child_session_ref` of a classic parent log: the pointer to a subagent
// run's own log file (step 10.19). Every text field is null when the log
// omitted it or it wasn't a string: such a ref is kept, not dropped, so the
// run it stands for can make the total unknown instead of silently lower.
export interface ChildSessionRef {
  // 0-based position among the log's user_messages (the positional join of
  // groupEnvelopesByUserMessage); null before the first one, which no turn owns.
  logTurnIndex: number | null;
  childSessionId: string | null;
  childLogFile: string | null;
  label: string | null;
  ts: number | null;
  // The parent's runSubagent tool_call span; absent on searchSubagent refs.
  parentSpanId: string | null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function collectChildSessionRefs(envelopes: JsonlEnvelope[]): ChildSessionRef[] {
  const refs: ChildSessionRef[] = [];
  let userMessages = 0;

  for (const envelope of envelopes) {
    if (envelope.type === "user_message") {
      userMessages += 1;
    } else if (envelope.type === "child_session_ref") {
      const attrs = envelope.attrs ?? {};
      refs.push({
        logTurnIndex: userMessages === 0 ? null : userMessages - 1,
        childSessionId: textOrNull(attrs.childSessionId),
        childLogFile: textOrNull(attrs.childLogFile),
        label: textOrNull(attrs.label),
        ts: typeof envelope.ts === "number" ? envelope.ts : null,
        parentSpanId: textOrNull(envelope.parentSpanId),
      });
    }
  }

  return refs;
}
