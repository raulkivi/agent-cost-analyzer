// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Phase 15 step 15.2: the remotes in a git `config` file, read as text (no
// `git` process). Only `[remote "<name>"]` sections and their `url` key are
// read; `url.<base>.insteadOf` rewrites and include files are not followed,
// so such a remote keys by its written url. Malformed lines are skipped.

export interface GitRemote {
  name: string;
  url: string;
}

const SECTION = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]/;
const ENTRY = /^([A-Za-z][A-Za-z0-9-]*)\s*=\s*(.*)$/;

// A value up to an unquoted comment, with surrounding quotes removed.
function readValue(raw: string): string {
  let out = "";
  let quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && (ch === "#" || ch === ";")) {
      break;
    }
    if (ch === "\\" && i + 1 < raw.length) {
      out += raw[++i];
      continue;
    }
    out += ch;
  }
  return out.trim();
}

export function parseGitConfigRemotes(text: string): GitRemote[] {
  const remotes: GitRemote[] = [];
  const seen = new Set<string>();
  let current: string | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) {
      continue;
    }
    const section = SECTION.exec(line);
    if (section) {
      current = section[1]!.toLowerCase() === "remote" && section[2] !== undefined ? section[2] : null;
      continue;
    }
    const entry = ENTRY.exec(line);
    if (!entry || current === null || entry[1]!.toLowerCase() !== "url" || seen.has(current)) {
      continue;
    }
    const url = readValue(entry[2]!);
    if (url !== "") {
      remotes.push({ name: current, url });
      seen.add(current);
    }
  }
  return remotes;
}

// `origin` is the remote people mean by "the repository"; otherwise the
// first one written.
export function preferredRemoteUrl(remotes: readonly GitRemote[]): string | null {
  return (remotes.find((remote) => remote.name === "origin") ?? remotes[0])?.url ?? null;
}
