// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { subagentLabelSchema, subagentRunIdSchema, type SubagentRunUsage } from "@agent-cost-analyzer/domain";
import type { ChildSessionRef } from "./child-session-refs.js";

// Step 10.20: one run 10.19's attribution knows of, read or not, with what the
// audit needs to read its calls (the file) or to say why it can't (the
// reason). `runId` and `label` are the cost side's where the run was read,
// else the ref's own when they match the shared patterns, else a stand-in, so
// a gap built from them is always schema-valid.
export interface AttributedRun {
  logTurn: number;
  runId: string;
  label: string;
  attribution: SubagentRunUsage["attribution"];
  // The ref's own data, to link the run to the call that started it (null for
  // an orphan, which has no ref).
  refTs: number | null;
  parentSpanId: string | null;
  log:
    | {
        status: "read";
        childLogFile: string;
        // Refs the run's own log holds: nested runs, which are not read (D6).
        nestedRefs: ChildSessionRef[];
      }
    | { status: "unread"; reason: string };
}

// A subagent file no turn could own: an unread run of the session with no
// turn to show it on.
export interface UnplacedRunFile {
  childLogFile: string | null;
  reason: string;
}

export type RefLogOutcome =
  | { status: "read"; run: SubagentRunUsage; nestedRefs: ChildSessionRef[] }
  | { status: "unreadable"; reason: string };

// A ref without a usable id or label gets a stand-in, never a guess: the id by
// position, the label "runSubagent-unknown".
export function runIdentityOf(
  ref: Pick<ChildSessionRef, "childSessionId" | "label">,
  ordinal: number,
): Pick<AttributedRun, "runId" | "label"> {
  const id = subagentRunIdSchema.safeParse(ref.childSessionId);
  const label = subagentLabelSchema.safeParse(ref.label);
  return {
    runId: id.success ? id.data : `unidentified-run-${ordinal}`,
    label: label.success ? label.data : "runSubagent-unknown",
  };
}

// Collects the audit's view of the attribution as the attribution runs, so no
// run is known to the cost side and missing from the audit.
export class AttributedRunLedger {
  readonly runs: AttributedRun[] = [];
  readonly unplaced: UnplacedRunFile[] = [];

  recordRef(logTurn: number, ref: ChildSessionRef, outcome: RefLogOutcome): void {
    const identity =
      outcome.status === "read" ? { runId: outcome.run.id, label: outcome.run.label } : runIdentityOf(ref, this.runs.length + 1);
    this.runs.push({
      logTurn,
      ...identity,
      attribution: "child-session-ref",
      refTs: ref.ts,
      parentSpanId: ref.parentSpanId,
      log:
        outcome.status === "read" && ref.childLogFile !== null
          ? { status: "read", childLogFile: ref.childLogFile, nestedRefs: outcome.nestedRefs }
          : { status: "unread", reason: outcome.status === "unreadable" ? outcome.reason : "The subagent log could not be read." },
    });
  }

  // `run` is `RunReadOutcome`'s read case: the orphan's identity is the file's.
  recordOrphan(logTurn: number, run: SubagentRunUsage, childLogFile: string, nestedRefs: ChildSessionRef[]): void {
    this.runs.push({
      logTurn,
      runId: run.id,
      label: run.label,
      attribution: "timestamp",
      refTs: null,
      parentSpanId: null,
      log: { status: "read", childLogFile, nestedRefs },
    });
  }

  recordUnplaced(childLogFile: string | null, reason: string): void {
    this.unplaced.push({ childLogFile, reason });
  }
}
