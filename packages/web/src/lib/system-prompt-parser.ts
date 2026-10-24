// A defensive, non-strict XML-ish parser for the tag structure GitHub
// Copilot Chat's system prompt is built from (<instructions>,
// <securityRequirements>, <skills><skill>..., <attachment filePath="...">,
// etc). The prompt is not guaranteed valid XML — it's plain prose that
// happens to contain these tags, so prose can legitimately contain stray
// "<...>" text that was never meant as a tag (e.g. a literal placeholder
// like "<your-model-id>"). Never throws; a genuine structural problem
// (unclosed or crossed real tags) degrades to a single unparsed section
// covering the whole text, never a fabricated/guessed structure.

export interface PromptNode {
  id: string;
  tagName: string | null; // null = untagged text (preamble/trailing/unparsed-fallback)
  attrs: Record<string, string>;
  depth: number; // 0 = synthetic root
  start: number;
  contentStart: number;
  contentEnd: number;
  end: number;
  children: PromptNode[];
}

export interface ParsedSystemPrompt {
  root: PromptNode;
  malformed: boolean;
}

const TAG_PATTERN = /<(\/)?([A-Za-z_][\w.-]*)((?:\s+[A-Za-z_][\w-]*="[^"]*")*)\s*>/g;
const ATTR_PATTERN = /([A-Za-z_][\w-]*)="([^"]*)"/g;

interface RawMatch {
  closing: boolean;
  name: string;
  attrs: Record<string, string>;
  start: number;
  end: number;
  atTagBoundary: boolean;
}

function scanTags(text: string): RawMatch[] {
  const matches: RawMatch[] = [];
  for (const match of text.matchAll(TAG_PATTERN)) {
    const [full, closingSlash, name, attrsRaw] = match;
    const attrs: Record<string, string> = {};
    for (const attrMatch of attrsRaw.matchAll(ATTR_PATTERN)) {
      attrs[attrMatch[1]] = attrMatch[2];
    }
    const before = text[match.index - 1];
    matches.push({
      closing: closingSlash === "/",
      name,
      attrs,
      start: match.index,
      end: match.index + full.length,
      // A real opening tag starts a line or immediately follows another
      // tag's ">" — an inline prose mention ("the <file> element") is
      // preceded by an ordinary space/word character instead.
      atTagBoundary: match.index === 0 || before === "\n" || before === ">",
    });
  }
  return matches;
}

// Prose can legitimately contain a "<tag>"-shaped substring that was never
// meant as markup — a placeholder like "<your-model-id>" mentioned inline,
// or a sentence referring to "the <file> element" by name. Two signals
// distinguish real structural tags from this kind of noise, neither
// requiring any hardcoded tag name:
//   1. A real *opening* tag always sits at a tag boundary — start of text,
//      right after a newline, or immediately after another tag's ">" (tags
//      packed tight with no separator). An inline prose mention is instead
//      preceded by an ordinary space/word character. (Closing tags
//      legitimately appear mid-line right after content, e.g.
//      "<name>graphify</name>", so this check only applies to opens.)
//   2. A genuinely structural tag name has both an opening and a closing
//      occurrence somewhere in the document — this alone catches a
//      never-closed placeholder even when it happens to sit at a boundary.
// A candidate tag must pass both to be treated as structural.
function structuralMatches(matches: RawMatch[]): RawMatch[] {
  const openNames = new Set(matches.filter((m) => !m.closing && m.atTagBoundary).map((m) => m.name));
  const closeNames = new Set(matches.filter((m) => m.closing).map((m) => m.name));
  const names = new Set([...openNames].filter((name) => closeNames.has(name)));
  return matches.filter((m) => names.has(m.name) && (m.closing || m.atTagBoundary));
}

function emptyNode(tagName: string | null, depth: number, start: number, end: number): PromptNode {
  return { id: "", tagName, attrs: {}, depth, start, contentStart: start, contentEnd: end, end, children: [] };
}

// insertTextGaps (run unconditionally in parseSystemPrompt) turns this
// childless root into a single node spanning the whole text, as long as
// it's not pure whitespace — same mechanism as the preamble/trailing gaps.
function fallback(text: string): ParsedSystemPrompt {
  return { root: emptyNode(null, 0, 0, text.length), malformed: true };
}

function buildTree(text: string, matches: RawMatch[]): ParsedSystemPrompt | null {
  const root = emptyNode(null, 0, 0, text.length);
  const stack: PromptNode[] = [root];

  for (const match of matches) {
    if (match.closing) {
      const top = stack[stack.length - 1];
      if (stack.length === 1 || top.tagName !== match.name) {
        return null; // crossed or unmatched closing tag — genuinely malformed
      }
      top.contentEnd = match.start;
      top.end = match.end;
      stack.pop();
    } else {
      const parent = stack[stack.length - 1];
      const node: PromptNode = {
        id: "",
        tagName: match.name,
        attrs: match.attrs,
        depth: parent.depth + 1,
        start: match.start,
        contentStart: match.end,
        contentEnd: match.end,
        end: match.end,
        children: [],
      };
      parent.children.push(node);
      stack.push(node);
    }
  }

  if (stack.length !== 1) {
    return null; // one or more real tags never closed
  }

  return { root, malformed: false };
}

// Splices untagged, non-whitespace text found between/around root's
// top-level tag children into synthetic tagName:null nodes, so preamble
// and trailing content are navigable like any other section. Purely
// whitespace gaps are left as plain gaps (no node needed — the renderer
// shows them inline between colored sections regardless).
function insertTextGaps(root: PromptNode, text: string): void {
  const withGaps: PromptNode[] = [];
  let cursor = 0;
  for (const child of root.children) {
    if (text.slice(cursor, child.start).trim().length > 0) {
      withGaps.push(emptyNode(null, 1, cursor, child.start));
    }
    withGaps.push(child);
    cursor = child.end;
  }
  if (text.slice(cursor, text.length).trim().length > 0) {
    withGaps.push(emptyNode(null, 1, cursor, text.length));
  }
  root.children = withGaps;
}

function assignIds(node: PromptNode, id: string): void {
  node.id = id;
  node.children.forEach((child, index) => assignIds(child, `${id}.${index}`));
}

export function parseSystemPrompt(text: string): ParsedSystemPrompt {
  const matches = structuralMatches(scanTags(text));

  const parsed = buildTree(text, matches) ?? fallback(text);
  insertTextGaps(parsed.root, text);
  assignIds(parsed.root, "root");
  return parsed;
}
