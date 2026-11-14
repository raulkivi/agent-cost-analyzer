// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { SystemPromptComponent } from "@agent-cost-analyzer/domain";
import { estimateTokenCount } from "../jsonl/token-estimator.js";
import type { PiSystemPromptState } from "./system-message-replay.js";
import type { PiSystemPromptSidecarRecord } from "./system-prompt-sidecar-reader.js";

export const ADDED_BY_PI_EXTENSIONS_LABEL = "Added by pi extensions";

// Shown with the breakdown when only pi's own in-file prompt is available.
export const PI_IN_FILE_PROMPT_NOTE =
  "This is the system prompt pi saved in the session file. It leaves out text that other pi extensions add when the " +
  "request is sent (for example working-directory or mount notes), so the real prompt is larger. The " +
  "pi-system-prompt-logger extension records the exact prompt; with it installed this view shows the exact size.";

// One contiguous slice of the sidecar's prompt. Parts are in sidecar order and
// their `text` values concatenate to exactly the sidecar prompt. Whitespace
// between two claimed pieces is attached to the preceding part, so no
// separator-only "extension" part appears.
export interface PiPromptPart {
  // pi's section name; undefined for the base content and for extension text.
  name?: string;
  text: string;
  // Length of pi's own text for a base/section part (excludes attached separators).
  ownChars?: number;
  base?: true;
}

export interface CombinedSystemPrompt {
  text: string;
  parts: PiPromptPart[];
  components: SystemPromptComponent[];
}

interface Piece {
  name?: string;
  text: string;
  base?: true;
}
interface Claim extends Piece {
  start: number;
  end: number;
}

function piecesOf(state: PiSystemPromptState): Piece[] {
  const pieces: Piece[] = [];
  if (state.baseContent.length > 0) {
    pieces.push({ text: state.baseContent, base: true });
  }
  for (const section of state.sections) {
    if (section.text.length > 0) {
      pieces.push({ name: section.name, text: section.text });
    }
  }
  return pieces;
}

function overlaps(claims: Claim[], start: number, end: number): boolean {
  return claims.some((claim) => start < claim.end && end > claim.start);
}

// Longest pieces first, so a short section can't claim text that sits inside a
// longer one; each claims its earliest verbatim, non-overlapping occurrence.
function claimPieces(pieces: Piece[], sidecarText: string): Claim[] {
  const claims: Claim[] = [];
  const byLengthDesc = pieces
    .map((piece, order) => ({ piece, order }))
    .sort((a, b) => b.piece.text.length - a.piece.text.length || a.order - b.order);
  for (const { piece } of byLengthDesc) {
    let from = sidecarText.indexOf(piece.text);
    while (from !== -1 && overlaps(claims, from, from + piece.text.length)) {
      from = sidecarText.indexOf(piece.text, from + 1);
    }
    if (from !== -1) {
      claims.push({ ...piece, start: from, end: from + piece.text.length });
    }
  }
  return claims.sort((a, b) => a.start - b.start);
}

function partsOf(claims: Claim[], sidecarText: string): PiPromptPart[] {
  const parts: PiPromptPart[] = [];
  let leadingSeparator = "";
  const addGap = (gap: string): void => {
    if (gap.length === 0) {
      return;
    }
    if (gap.trim().length > 0) {
      parts.push({ text: gap });
    } else if (parts.length > 0) {
      parts[parts.length - 1].text += gap;
    } else {
      leadingSeparator = gap;
    }
  };

  let cursor = 0;
  for (const claim of claims) {
    addGap(sidecarText.slice(cursor, claim.start));
    parts.push({
      ...(claim.name !== undefined ? { name: claim.name } : {}),
      ...(claim.base ? { base: true as const } : {}),
      text: leadingSeparator + claim.text,
      ownChars: claim.text.length,
    });
    leadingSeparator = "";
    cursor = claim.end;
  }
  addGap(sidecarText.slice(cursor));
  return parts;
}

function componentOf(part: PiPromptPart): SystemPromptComponent {
  const tokenCount = estimateTokenCount(part.text);
  if (part.ownChars === undefined) {
    return {
      kind: "built-in",
      label: `${ADDED_BY_PI_EXTENSIONS_LABEL} (${part.text.length.toLocaleString()} characters)`,
      tokenCount,
    };
  }
  const chars = part.ownChars.toLocaleString();
  return {
    kind: "built-in",
    label: part.base ? `Base system prompt (${chars} characters)` : `Prompt section "${part.name}" (${chars} characters)`,
    tokenCount,
  };
}

// Combines both sources for one branch. The sidecar holds the exact prompt pi
// sent, so text and size come from it. pi's in-file pieces (base content and
// sections) name the parts of it they cover verbatim; everything else in the
// sidecar text — extension additions, and any section that was rewritten
// before sending, such as `mcp_servers` — is reported as "Added by pi
// extensions" rather than guessed at. Tool definitions stay sized from the
// in-file declarations; they are not part of the prompt text.
export function buildCombinedSystemPrompt(
  state: PiSystemPromptState,
  record: PiSystemPromptSidecarRecord,
): CombinedSystemPrompt {
  const parts = partsOf(claimPieces(piecesOf(state), record.systemPrompt), record.systemPrompt);
  const components = parts.map(componentOf);
  if (state.tools.length > 0) {
    components.push({
      kind: "tool-definitions",
      label: `Tool definitions (${state.tools.length} tools)`,
      tokenCount: estimateTokenCount(JSON.stringify(state.tools)),
    });
  }
  return { text: record.systemPrompt, parts, components };
}
