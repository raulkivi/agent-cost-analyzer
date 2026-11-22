// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The npm-package smoke's checks of what the installed package does
// (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/npm-package.md §4.8 steps 3-6), as pure functions.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  expectedMcpSurface,
  isJavaScriptContentType,
  isLoopbackRequest,
  jsonRpcLineProblems,
  mcpSurfaceProblems,
  moduleScriptPath,
  nodeWarningLines,
  parseStartLine,
  serveProblems,
  type ServeFacts,
} from "../smoke/checks.mts";

describe("parseStartLine", () => {
  it("reads the version and port from the serve command's line", () => {
    expect(parseStartLine("Agent Cost Analyzer 0.15.0 on http://127.0.0.1:43127 (Ctrl+C to stop)")).toEqual({
      version: "0.15.0",
      port: 43127,
      origin: "http://127.0.0.1:43127",
    });
    expect(parseStartLine("Agent Cost Analyzer 1.0.0-rc.1 on http://127.0.0.1:5199 (Ctrl+C to stop)")?.version).toBe("1.0.0-rc.1");
  });

  it("refuses any other line, another host or a port out of range", () => {
    for (const line of [
      "",
      "Agent Cost Analyzer is already running on http://127.0.0.1:5199 (opening it)",
      "Agent Cost Analyzer 0.15.0 on http://localhost:5199 (Ctrl+C to stop)",
      "Agent Cost Analyzer 0.15.0 on http://0.0.0.0:5199 (Ctrl+C to stop)",
      "Agent Cost Analyzer 0.15.0 on http://127.0.0.1:0 (Ctrl+C to stop)",
      "Agent Cost Analyzer 0.15.0 on http://127.0.0.1:65536 (Ctrl+C to stop)",
      "Agent Cost Analyzer 0.15.0 on http://127.0.0.1:5199 (Ctrl+C to stop) extra",
    ]) {
      expect(parseStartLine(line), line).toBeUndefined();
    }
  });
});

describe("moduleScriptPath", () => {
  it("finds the web app's entry script in index.html", () => {
    const html = `<!doctype html><html><head><script>/* color mode */</script>
      <script type="module" crossorigin src="/assets/index-AbC123.js"></script>
      <link rel="stylesheet" crossorigin href="/assets/index-XyZ.css"></head><body><div id="root"></div></body></html>`;
    expect(moduleScriptPath(html)).toBe("/assets/index-AbC123.js");
  });

  it("skips an inline script that mentions a src", () => {
    const html = `<script>var src = "x"; document.documentElement.setAttribute("data-color-mode", "dark");</script>
    <script type="module" crossorigin src="/assets/index-cNIgNYpw.js"></script>`;
    expect(moduleScriptPath(html)).toBe("/assets/index-cNIgNYpw.js");
  });

  it("is undefined without a same-origin module script", () => {
    expect(moduleScriptPath("<html><script>inline()</script></html>")).toBeUndefined();
    expect(moduleScriptPath('<script type="module" src="https://cdn.example/x.js"></script>')).toBeUndefined();
  });
});

describe("isJavaScriptContentType", () => {
  it("accepts the JavaScript media types express serves", () => {
    expect(isJavaScriptContentType("text/javascript; charset=utf-8")).toBe(true);
    expect(isJavaScriptContentType("application/javascript; charset=UTF-8")).toBe(true);
  });

  it("refuses anything a browser would not run as a module", () => {
    for (const type of [undefined, "", "text/html; charset=utf-8", "text/plain", "application/octet-stream", "text/javascriptx"]) {
      expect(isJavaScriptContentType(type), String(type)).toBe(false);
    }
  });
});

describe("isLoopbackRequest", () => {
  it("allows the app's own origin and requests that never reach a network", () => {
    for (const url of ["http://127.0.0.1:5199/", "http://127.0.0.1:43127/api/health", "data:font/woff2;base64,AAAA", "blob:http://127.0.0.1:5199/1f2e", "about:blank"]) {
      expect(isLoopbackRequest(url), url).toBe(true);
    }
  });

  it("refuses any other host, including other loopback names", () => {
    for (const url of ["https://fonts.googleapis.com/css2", "http://localhost:5199/", "http://[::1]:5199/", "http://127.0.0.2/", "ws://example.com/", "not a url"]) {
      expect(isLoopbackRequest(url), url).toBe(false);
    }
  });
});

describe("jsonRpcLineProblems", () => {
  it("passes JSON-RPC 2.0 messages, one per line", () => {
    expect(
      jsonRpcLineProblems([
        '{"jsonrpc":"2.0","id":1,"result":{}}',
        '{"jsonrpc":"2.0","method":"notifications/tools/list_changed"}',
        '{"jsonrpc":"2.0","id":2,"error":{"code":-32601,"message":"x"}}',
      ]),
    ).toEqual([]);
  });

  it("names every line that is not a JSON-RPC 2.0 message", () => {
    expect(jsonRpcLineProblems(["npm warn exec", "", '{"id":1}', "[1]", '{"jsonrpc":"2.0","id":1,"result":{}}'])).toEqual([
      'stdout line 1 is not JSON-RPC: "npm warn exec"',
      'stdout line 2 is not JSON-RPC: ""',
      'stdout line 3 is not JSON-RPC: "{\\"id\\":1}"',
      'stdout line 4 is not JSON-RPC: "[1]"',
    ]);
  });

  it("fails when there was no message at all", () => {
    expect(jsonRpcLineProblems([])).toEqual(["stdout carried no JSON-RPC message"]);
  });
});

describe("nodeWarningLines", () => {
  it("finds Node's warnings, such as node:sqlite's ExperimentalWarning, which the shim filters", () => {
    const stderr = [
      "Copilot Chat file logging is off.",
      "(node:1234) ExperimentalWarning: SQLite is an experimental feature and might change at any time",
      "(Use `node --trace-warnings ...` to show where the warning was created)",
      "(node:1234) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.",
    ].join("\n");
    expect(nodeWarningLines(stderr)).toEqual([
      "(node:1234) ExperimentalWarning: SQLite is an experimental feature and might change at any time",
      "(Use `node --trace-warnings ...` to show where the warning was created)",
      "(node:1234) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.",
    ]);
  });

  it("finds nothing in the app's own lines", () => {
    expect(nodeWarningLines("")).toEqual([]);
    expect(nodeWarningLines("Port 5199 is in use; using 5200 instead.\n")).toEqual([]);
  });
});

describe("serveProblems", () => {
  const INDEX = '<!doctype html><script type="module" crossorigin src="/assets/index-1.js"></script>';
  const headers = { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'self'; script-src 'self'", "x-content-type-options": "nosniff" };
  const good: ServeFacts = {
    health: { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "ok", app: "agent-cost-analyzer", version: "1.2.3" }) },
    index: { status: 200, headers, body: INDEX },
    packagedIndex: INDEX,
    asset: { path: "/assets/index-1.js", reply: { status: 200, headers: { "content-type": "text/javascript; charset=utf-8" }, body: "export {};" } },
    foreignHost: { status: 403, headers: {}, body: "" },
  };

  it("passes the package's health, app shell, asset, headers and Host guard", () => {
    expect(serveProblems(good, "1.2.3")).toEqual([]);
  });

  it("checks /api/health: 200, this app, the package version", () => {
    expect(serveProblems({ ...good, health: { ...good.health, status: 500 } }, "1.2.3")).toEqual(["GET /api/health returned 500, expected 200"]);
    expect(serveProblems(good, "1.2.4")).toEqual(['GET /api/health reported {"app":"agent-cost-analyzer","version":"1.2.3"}, expected {"app":"agent-cost-analyzer","version":"1.2.4"}']);
    expect(serveProblems({ ...good, health: { ...good.health, body: "<html>" } }, "1.2.3")).toEqual(["GET /api/health did not return JSON"]);
  });

  it("checks that / serves the packaged index.html as HTML", () => {
    expect(serveProblems({ ...good, index: { ...good.index, status: 404 } }, "1.2.3")).toEqual(["GET / returned 404, expected 200"]);
    expect(serveProblems({ ...good, index: { ...good.index, headers: { ...headers, "content-type": "text/plain" } } }, "1.2.3")).toEqual(['GET / has content type "text/plain", expected text/html']);
    expect(serveProblems({ ...good, packagedIndex: "<html>other</html>" }, "1.2.3")).toEqual(["GET / is not the packaged dist/web/index.html"]);
  });

  it("checks the Content Security Policy and nosniff on the app shell", () => {
    const without = (name: string) => Object.fromEntries(Object.entries(headers).filter(([key]) => key !== name));
    expect(serveProblems({ ...good, index: { ...good.index, headers: without("content-security-policy") } }, "1.2.3")).toEqual([
      "GET / has no Content-Security-Policy with default-src 'self'",
    ]);
    expect(serveProblems({ ...good, index: { ...good.index, headers: { ...headers, "content-security-policy": "script-src *" } } }, "1.2.3")).toEqual([
      "GET / has no Content-Security-Policy with default-src 'self'",
    ]);
    expect(serveProblems({ ...good, index: { ...good.index, headers: without("x-content-type-options") } }, "1.2.3")).toEqual(["GET / lacks X-Content-Type-Options: nosniff"]);
  });

  it("checks that the entry script loads as JavaScript", () => {
    expect(serveProblems({ ...good, asset: undefined }, "1.2.3")).toEqual(["index.html names no same-origin module script"]);
    expect(serveProblems({ ...good, asset: { path: "/assets/index-1.js", reply: { status: 200, headers: { "content-type": "text/html" }, body: INDEX } } }, "1.2.3")).toEqual([
      'GET /assets/index-1.js has content type "text/html", expected JavaScript',
    ]);
    expect(serveProblems({ ...good, asset: { path: "/assets/index-1.js", reply: { status: 404, headers: {}, body: "" } } }, "1.2.3")).toEqual([
      "GET /assets/index-1.js returned 404, expected 200",
      "GET /assets/index-1.js has content type undefined, expected JavaScript",
    ]);
  });

  it("checks that a request naming another Host is refused (DNS rebinding)", () => {
    expect(serveProblems({ ...good, foreignHost: { status: 200, headers: {}, body: "{}" } }, "1.2.3")).toEqual(["GET /api/health with Host: evil.example returned 200, expected 403"]);
  });
});

describe("the MCP surface", () => {
  const snapshot = {
    withoutViews: { tools: [{ name: "list_sessions" }], resources: [] },
    withViews: {
      tools: [{ name: "list_sessions" }, { name: "get_turn_series" }],
      resources: [{ uri: "ui://agent-cost-analyzer/views.html", name: "Cost views" }],
    },
  };

  it("expects the tool list contract's with-views variant, as the package serves its views by default", () => {
    expect(expectedMcpSurface(snapshot)).toEqual({ tools: ["get_turn_series", "list_sessions"], resources: ["ui://agent-cost-analyzer/views.html"] });
  });

  it("reads the real contract snapshot (packages/server tool-list-contract.test.ts)", () => {
    const file = path.resolve(import.meta.dirname, "..", "..", "server", "src", "mcp", "__snapshots__", "tool-list-standalone.json");
    const expected = expectedMcpSurface(JSON.parse(readFileSync(file, "utf8")));
    expect(expected.tools).toContain("list_sessions");
    expect(expected.tools).toContain("get_turn_series");
    expect(expected.resources).toEqual(["ui://agent-cost-analyzer/views.html"]);
  });

  it("refuses a snapshot of another shape", () => {
    expect(() => expectedMcpSurface({ withoutViews: {} })).toThrow(/withViews/);
  });

  const expected = expectedMcpSurface(snapshot);

  it("passes the expected version, tools and resources, in any order", () => {
    expect(mcpSurfaceProblems(expected, { version: "1.2.3", tools: ["list_sessions", "get_turn_series"], resources: ["ui://agent-cost-analyzer/views.html"] }, "1.2.3")).toEqual([]);
  });

  it("names a wrong version, a missing or extra tool and a missing resource", () => {
    expect(mcpSurfaceProblems(expected, { version: "0.0.0", tools: ["list_sessions", "run_shell"], resources: [] }, "1.2.3")).toEqual([
      'initialize returned version "0.0.0", expected "1.2.3"',
      "tools/list lacks get_turn_series",
      "tools/list has unexpected run_shell",
      "resources/list lacks ui://agent-cost-analyzer/views.html",
    ]);
    expect(mcpSurfaceProblems(expected, { tools: ["list_sessions", "get_turn_series"], resources: ["ui://agent-cost-analyzer/views.html"] }, "1.2.3")).toEqual([
      'initialize returned version undefined, expected "1.2.3"',
    ]);
  });
});
