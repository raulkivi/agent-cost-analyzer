// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SystemPromptComponent } from "@agent-cost-analyzer/domain";
import type { PiRawEntry } from "./pi-jsonl-reader.js";
import { replaySystemMessages, type PiSystemPromptState } from "./system-message-replay.js";
import { buildPiSystemPromptComponents, buildPiSystemPromptComponentsFromState } from "./system-prompt-components.js";
import { buildCombinedSystemPrompt, PI_IN_FILE_PROMPT_NOTE } from "./system-prompt-combiner.js";
import { branchEndTimestamp, selectSidecarRecord } from "./system-prompt-sidecar-matcher.js";
import type { PiSystemPromptSidecarRecord } from "./system-prompt-sidecar-reader.js";

export interface ResolvedPiSystemPrompt {
  // Prompt text as sent when known exactly, else pi's in-file text; null when neither source exists.
  text: string | null;
  components: SystemPromptComponent[] | undefined;
  // Set only when the text is pi's in-file prompt, which omits extension additions.
  note: string | undefined;
  // pi's own replayed state (tool declarations, sections); null without in-file system messages.
  state: PiSystemPromptState | null;
}

// Picks the system prompt for one branch from the two sources:
//  - in-file + matching sidecar record: exact text/size from the sidecar,
//    breakdown from pi's sections plus "Added by pi extensions";
//  - in-file only: pi's text, with a note that extension additions are missing;
//  - sidecar only (sessions recorded before pi persisted system messages): the sidecar as before.
export function resolvePiSystemPrompt(
  branch: PiRawEntry[],
  sidecarRecords: readonly PiSystemPromptSidecarRecord[] | undefined,
  // D27: the leading requests an earlier branch of the file owns; they are not counted per tool.
  skipRequests = 0,
): ResolvedPiSystemPrompt {
  const state = replaySystemMessages(branch, skipRequests);
  const record = selectSidecarRecord(sidecarRecords, branchEndTimestamp(branch));

  if (state && record) {
    const combined = buildCombinedSystemPrompt(state, record);
    return { text: combined.text, components: combined.components, note: undefined, state };
  }
  if (state) {
    return { text: state.text, components: buildPiSystemPromptComponentsFromState(state), note: PI_IN_FILE_PROMPT_NOTE, state };
  }
  if (record) {
    return { text: record.systemPrompt, components: buildPiSystemPromptComponents(record), note: undefined, state: null };
  }
  return { text: null, components: undefined, note: undefined, state: null };
}
