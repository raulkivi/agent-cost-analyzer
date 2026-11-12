// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test as base, expect } from "@playwright/test";
import { createFixtureHome } from "../../../web/e2e/support/fixture-home.mts";
import { connectStdioMcp } from "../../../web/e2e/support/mcp-stdio.js";
import { CLAUDE_SETS, VSCODE_SETS, type HostSet } from "../../test/theme/host-sets.js";
import { hostProfileFrom, type HostProfile, type HostRecording } from "./host-context.js";
import { McpHost } from "./mcp-host.js";

// Each test gets the real standalone stdio MCP server (what
// scripts/mcp-server.sh runs, with --app-views-html on the built
// dist/views.html) over a fresh copy of the web-e2e fixture home: a new
// temporary HOME with Claude Code, pi, Copilot and mitmproxy sessions in
// four repositories and three projects. Nothing on this machine is read.
// The host is Claude Desktop as the A0 spike recorded it, unless a spec
// picks another with test.use({ hostKind }).

const mcpAppsDir = path.resolve(import.meta.dirname, "../..");
const VIEWS_HTML = path.join(mcpAppsDir, "dist/views.html");
const RECORDINGS = path.resolve(mcpAppsDir, "../../docs/plans/mcp-apps-spike-results");

// The app's version, which every view's footer shows (the server reads its own package.json).
export const APP_VERSION = (JSON.parse(readFileSync(path.join(mcpAppsDir, "../server/package.json"), "utf8")) as { version: string }).version;

export const CLAUDE_DARK = CLAUDE_SETS.find((set) => set.theme === "dark")!;
export const CLAUDE_LIGHT = CLAUDE_SETS.find((set) => set.theme === "light")!;
export { CLAUDE_SETS, VSCODE_SETS };

export type HostKind = "claude" | "vscode";

function recordedProfile(kind: HostKind, set: HostSet): HostProfile {
  const file = kind === "claude" ? `claude-${set.theme}.json` : "vscode-dark.json";
  return hostProfileFrom(JSON.parse(readFileSync(path.join(RECORDINGS, file), "utf8")) as HostRecording);
}

export const test = base.extend<{ hostKind: HostKind; hostSet: HostSet; withProjects: boolean; host: McpHost }>({
  hostKind: ["claude", { option: true }],
  hostSet: [CLAUDE_DARK, { option: true }],
  // false: the fixture home has no projects file (A24 2.6).
  withProjects: [true, { option: true }],
  host: async ({ page, hostKind, hostSet, withProjects }, use) => {
    if (!existsSync(VIEWS_HTML)) throw new Error("packages/mcp-apps/dist/views.html is not built: run `npm run build --workspace=packages/mcp-apps` first");
    const home = mkdtempSync(path.join(os.tmpdir(), "aca-e2e-mcp-apps-"));
    createFixtureHome(home, { projects: withProjects });
    const server = await connectStdioMcp(home, { args: ["--app-views-html", VIEWS_HTML], clientName: "fake-mcp-apps-host" });
    try {
      const host = await McpHost.open(page, server, recordedProfile(hostKind, hostSet), hostSet);
      await use(host);
      // Security rule of the suite: the host page and the view load nothing from the network.
      expect(host.blockedRequests, "requests outside the host page and the view").toEqual([]);
    } finally {
      await server.close();
      rmSync(home, { recursive: true, force: true });
    }
  },
});

// Runs the same specs in each of Claude's recorded theme sets (light, dark).
export function inEachClaudeSet(define: () => void): void {
  for (const set of CLAUDE_SETS) {
    test.describe(set.theme, () => {
      test.use({ hostSet: set });
      define();
    });
  }
}

export { expect };
