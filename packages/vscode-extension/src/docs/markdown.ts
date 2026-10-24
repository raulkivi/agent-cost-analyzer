// Pure Markdown helpers for the doc checks (docs.test.ts, step 10.10): the
// headings GitHub turns into anchors and the links a page contains. They
// cover the Markdown this repo writes, not every CommonMark corner.

export interface MarkdownLink {
  target: string;
  image: boolean;
  // 1-based, for failure messages.
  line: number;
}

// GitHub's heading id (github-slugger): lowercase, drop every character
// that isn't a letter, mark, number, connector ("_"), "-" or a space, then
// turn each space into "-" (runs aren't collapsed).
export function githubSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

// The text a heading renders as: links and images become their text, code
// spans their content, emphasis markers and HTML tags go.
function renderedHeadingText(raw: string): string {
  return raw
    .replace(/\s+#+\s*$/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/(^|[^\p{L}\p{N}])_(.+?)_(?![\p{L}\p{N}])/gu, "$1$2");
}

// Lines outside fenced code blocks, with their 1-based numbers.
function proseLines(markdown: string): { text: string; line: number }[] {
  const result: { text: string; line: number }[] = [];
  let fence: string | null = null;
  markdown.split(/\r?\n/).forEach((text, index) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(text)?.[1];
    if (fence === null && marker) {
      fence = marker[0];
      return;
    }
    if (fence !== null) {
      if (marker && marker[0] === fence) {
        fence = null;
      }
      return;
    }
    result.push({ text, line: index + 1 });
  });
  return result;
}

// Every anchor a page offers: its ATX headings' slugs, numbered "-1", "-2"
// when repeated, plus explicit <a id> / <a name> anchors.
export function headingAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const { text } of proseLines(markdown)) {
    const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(text);
    if (heading) {
      const base = githubSlug(renderedHeadingText(heading[1]));
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      anchors.add(count === 0 ? base : `${base}-${count}`);
    }
    for (const match of text.matchAll(/<a\s+[^>]*\b(?:id|name)="([^"]+)"/gi)) {
      anchors.add(match[1]);
    }
  }
  return anchors;
}

const INLINE_LINK = /(!?)\[((?:[^[\]]|\[[^\]]*\])*)\]\(\s*(?:<([^>]*)>|([^\s)]+))(?:\s+"[^"]*")?\s*\)/g;

function inlineLinks(text: string, line: number, into: MarkdownLink[]): void {
  for (const match of text.matchAll(INLINE_LINK)) {
    into.push({ target: match[3] ?? match[4], image: match[1] === "!", line });
    // An image inside a link's text, e.g. a badge.
    inlineLinks(match[2], line, into);
  }
}

// Every link and image target outside code: inline links and images,
// reference definitions, and HTML <a href> / <img src>. HTML comments are
// skipped.
export function markdownLinks(markdown: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  const withoutComments = markdown.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, " "));
  for (const { text: rawText, line } of proseLines(withoutComments)) {
    const text = rawText.replace(/`[^`]*`/g, (code) => " ".repeat(code.length));
    const definition = /^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/.exec(text);
    if (definition) {
      links.push({ target: definition[1], image: false, line });
      continue;
    }
    inlineLinks(text, line, links);
    for (const match of text.matchAll(/<(a|img)\s[^>]*\b(href|src)="([^"]*)"/gi)) {
      links.push({ target: match[3], image: match[1].toLowerCase() === "img", line });
    }
  }
  return links;
}

// A target with a URL scheme (https:, mailto:, command:, ...). A one-letter
// "scheme" is a Windows drive, not a URL.
export function isAbsoluteUrl(target: string): boolean {
  return /^[a-z][a-z0-9+.-]+:/i.test(target);
}

// A relative target's file path (decoded, without a query) and anchor.
export function splitTarget(target: string): { path: string; anchor: string | undefined } {
  const hash = target.indexOf("#");
  const beforeHash = hash === -1 ? target : target.slice(0, hash);
  const anchor = hash === -1 ? undefined : target.slice(hash + 1);
  const path = decodeURIComponent(beforeHash.split("?")[0]);
  return { path, anchor };
}
