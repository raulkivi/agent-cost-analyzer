// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The npm-package smoke's checks of what the installed package does
// (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/npm-package.md §4.8 steps 4-6): pure, so the smoke's orchestration only
// gathers the facts.

export interface StartLine {
  version: string;
  port: number;
  origin: string;
}

// packages/cli/src/serve-command.ts prints it; the bind host is loopback only.
const START_LINE = /^Agent Cost Analyzer (\S+) on (http:\/\/127\.0\.0\.1:(\d{1,5})) \(Ctrl\+C to stop\)$/;

/** The serve command's start line, or undefined for any other line. */
export function parseStartLine(line: string): StartLine | undefined {
  const match = START_LINE.exec(line);
  if (match === null) return undefined;
  const port = Number(match[3]);
  if (port < 1 || port > 65_535) return undefined;
  return { version: match[1]!, port, origin: match[2]! };
}

/** The same-origin path of the web app's entry module script in index.html. */
export function moduleScriptPath(indexHtml: string): string | undefined {
  for (const [tag] of indexHtml.matchAll(/<script\b[^>]*>/gi)) {
    if (!/\stype\s*=\s*["']module["']/i.test(tag)) continue;
    const src = /\ssrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (src?.startsWith("/") && !src.startsWith("//")) return src;
  }
  return undefined;
}

/** True for the media types a browser runs as a JavaScript module. */
export const isJavaScriptContentType = (type: string | undefined): boolean => /^(text|application)\/javascript(\s*;|$)/i.test(type ?? "");

export interface HttpReply {
  status: number;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  body: string;
}

/** What the smoke fetched from the running server (§4.8 step 4). */
export interface ServeFacts {
  health: HttpReply;
  index: HttpReply;
  /** The installed package's dist/web/index.html. */
  packagedIndex: string;
  /** The entry module script index.html names, if any. */
  asset?: { path: string; reply: HttpReply };
  /** GET /api/health with `Host: evil.example`. */
  foreignHost: HttpReply;
}

const header = (reply: HttpReply, name: string): string | undefined => {
  const value = reply.headers[name];
  return Array.isArray(value) ? value.join(", ") : value;
};

const statusProblem = (label: string, reply: HttpReply, expected: number): string[] =>
  reply.status === expected ? [] : [`${label} returned ${reply.status}, expected ${expected}`];

function healthProblems(health: HttpReply, version: string): string[] {
  if (health.status !== 200) return statusProblem("GET /api/health", health, 200);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(health.body) as Record<string, unknown>;
  } catch {
    return ["GET /api/health did not return JSON"];
  }
  const expected = { app: "agent-cost-analyzer", version };
  const actual = { app: body?.app, version: body?.version };
  return JSON.stringify(actual) === JSON.stringify(expected)
    ? []
    : [`GET /api/health reported ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`];
}

function indexProblems(index: HttpReply, packagedIndex: string): string[] {
  const type = header(index, "content-type");
  const policy = header(index, "content-security-policy") ?? "";
  return [
    ...statusProblem("GET /", index, 200),
    ...(/^text\/html\b/i.test(type ?? "") ? [] : [`GET / has content type ${JSON.stringify(type)}, expected text/html`]),
    ...(index.status === 200 && index.body !== packagedIndex ? ["GET / is not the packaged dist/web/index.html"] : []),
    ...(/(^|;)\s*default-src 'self'\s*(;|$)/.test(policy) ? [] : ["GET / has no Content-Security-Policy with default-src 'self'"]),
    ...(header(index, "x-content-type-options") === "nosniff" ? [] : ["GET / lacks X-Content-Type-Options: nosniff"]),
  ];
}

/** Everything wrong with what the server answered; empty when the packaged app serves as planned (§4.4). */
export function serveProblems(facts: ServeFacts, version: string): string[] {
  const { asset } = facts;
  const assetType = asset === undefined ? undefined : header(asset.reply, "content-type");
  return [
    ...healthProblems(facts.health, version),
    ...indexProblems(facts.index, facts.packagedIndex),
    ...(asset === undefined
      ? ["index.html names no same-origin module script"]
      : [
          ...statusProblem(`GET ${asset.path}`, asset.reply, 200),
          ...(isJavaScriptContentType(assetType) ? [] : [`GET ${asset.path} has content type ${JSON.stringify(assetType)}, expected JavaScript`]),
        ]),
    ...statusProblem("GET /api/health with Host: evil.example", facts.foreignHost, 403),
  ];
}

// Schemes that never reach a network.
const LOCAL_SCHEMES = new Set(["data:", "blob:", "about:"]);

/** True when a request the page makes stays on 127.0.0.1 (§4.4: no network call by the app). */
export function isLoopbackRequest(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return LOCAL_SCHEMES.has(parsed.protocol) || parsed.hostname === "127.0.0.1";
}

/** Every stdout line of `agent-cost-analyzer mcp` must be a JSON-RPC 2.0 message (§4.6). */
export function jsonRpcLineProblems(lines: readonly string[]): string[] {
  if (lines.length === 0) return ["stdout carried no JSON-RPC message"];
  return lines.flatMap((line, index) => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      message = undefined;
    }
    const valid = typeof message === "object" && message !== null && !Array.isArray(message) && (message as Record<string, unknown>).jsonrpc === "2.0";
    return valid ? [] : [`stdout line ${index + 1} is not JSON-RPC: ${JSON.stringify(line)}`];
  });
}

/**
 * Node's own warning lines on stderr. The bin shim filters node:sqlite's
 * ExperimentalWarning (§4.2), so a user's first line is the app's own;
 * Node 22 prints it, Node 24 does not.
 */
export const nodeWarningLines = (stderr: string): string[] =>
  stderr.split(/\r?\n/).filter((line) => /^\(node:\d+\) \S*Warning: |^\(node:\d+\) \[\w+\] \w*Warning: |^\(Use `node --trace-warnings/.test(line));

export interface McpSurface {
  tools: string[];
  resources: string[];
}

const names = (entries: unknown, key: "name" | "uri", label: string): string[] => {
  if (!Array.isArray(entries)) throw new Error(`the tool-list snapshot has no ${label}`);
  return entries.map((entry) => String((entry as Record<string, unknown>)[key])).sort();
};

/**
 * What `agent-cost-analyzer mcp` must list, from the tool-list contract's
 * snapshot (packages/server/src/mcp/__snapshots__/tool-list-standalone.json):
 * its with-views variant, as the package serves its views by default.
 */
export function expectedMcpSurface(snapshot: unknown): McpSurface {
  const withViews = (snapshot as { withViews?: { tools?: unknown; resources?: unknown } } | null)?.withViews;
  if (withViews === undefined) throw new Error("the tool-list snapshot has no withViews variant");
  return { tools: names(withViews.tools, "name", "withViews.tools"), resources: names(withViews.resources, "uri", "withViews.resources") };
}

export function mcpSurfaceProblems(expected: McpSurface, actual: McpSurface & { version?: string }, version: string): string[] {
  const missing = (want: string[], have: string[]) => want.filter((name) => !have.includes(name));
  return [
    ...(actual.version === version ? [] : [`initialize returned version ${JSON.stringify(actual.version)}, expected ${JSON.stringify(version)}`]),
    ...missing(expected.tools, actual.tools).map((name) => `tools/list lacks ${name}`),
    ...missing(actual.tools, expected.tools).map((name) => `tools/list has unexpected ${name}`),
    ...missing(expected.resources, actual.resources).map((uri) => `resources/list lacks ${uri}`),
  ];
}
