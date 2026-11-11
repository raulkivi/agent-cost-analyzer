// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getToolUiResourceUri, type McpUiDisplayMode, type McpUiHostContext, type McpUiResourceCsp } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Page } from "@playwright/test";
import type { HostSet } from "../../test/theme/host-sets.js";
import type { ShowViewRequest } from "../host/host-page.js";
import { hostCallOf, type HostCall } from "./call-log.js";
import { hostContextFor, webviewVariables, type HostProfile } from "./host-context.js";
import { HOST_PAGE_URL, requestTarget, VIEW_URL, viewCsp, withWebviewVariables } from "./sandbox.js";
import { ViewFrame } from "./view-frame.js";

// The fake MCP Apps host (step 10.17 G5), the Node half: it plays the chat.
// It calls a tool on the real server as the model would, reads the view
// the tool names from the server (resources/read, brand injected), and
// hands both to the host page (host/host-page.ts), whose AppBridge shows
// the view. Whatever the view asks for comes back here through
// window.mcpHostRelay: it is recorded in `calls`, and a tools/call goes to
// the same server. Nothing else is loaded: any request that is not the host
// page or the view is refused and listed in `blockedRequests`. A VS Code
// host's view is served with VS Code's --vscode-* colours on its root, as
// its webview has them (a theme change mid-view does not update them).

const HOST_PAGE = path.resolve(import.meta.dirname, "../host/dist/host.html");

export interface ShowOptions {
  // The host's theme set for this view; the host's own set by default.
  set?: HostSet;
  width?: number;
  displayMode?: McpUiDisplayMode;
}

interface ViewResource {
  html: string;
  csp: string;
}

export class McpHost {
  // Every request the views made, in order (tools/call, ui/message, …).
  readonly calls: HostCall[] = [];
  readonly blockedRequests: string[] = [];
  private shown = 0;
  // The set of the view being shown, for the --vscode-* colours it is served with.
  private servedSet: HostSet;

  private constructor(
    private readonly page: Page,
    private readonly server: Client,
    private readonly profile: HostProfile,
    private readonly tools: Map<string, Tool>,
    private readonly view: ViewResource,
    private readonly set: HostSet,
  ) {
    this.servedSet = set;
  }

  static async open(page: Page, server: Client, profile: HostProfile, set: HostSet): Promise<McpHost> {
    if (!existsSync(HOST_PAGE)) throw new Error("The fake host's page is not built: run `npm run test:e2e --workspace=packages/mcp-apps`, which builds it");
    const { tools } = await server.listTools();
    const host = new McpHost(page, server, profile, new Map(tools.map((tool) => [tool.name, tool])), await readView(server, tools), set);
    await page.route("**/*", (route) => {
      const url = route.request().url();
      const target = requestTarget(url);
      if (target === "host-page") return route.fulfill({ contentType: "text/html", body: readFileSync(HOST_PAGE, "utf8") });
      if (target === "view") return route.fulfill({ contentType: "text/html", headers: { "content-security-policy": host.view.csp }, body: withWebviewVariables(host.view.html, webviewVariables(host.servedSet)) });
      host.blockedRequests.push(url);
      return route.abort("blockedbyclient");
    });
    await page.exposeFunction("mcpHostRelay", (method: string, params: Record<string, unknown>) => host.relay(method, params));
    await page.goto(HOST_PAGE_URL);
    return host;
  }

  // The model calls `tool` and reads the answer, with no view shown (e.g. list_sessions, to find an id for a later call).
  async callAsModel(tool: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return (await this.server.callTool({ name: tool, arguments: args })) as CallToolResult;
  }

  // The model calls `tool`; its view appears under the call.
  async show(tool: string, args: Record<string, unknown>, options: ShowOptions = {}): Promise<ViewFrame> {
    const definition = this.tools.get(tool);
    if (!definition) throw new Error(`The server has no tool ${tool}`);
    const toolResult = (await this.server.callTool({ name: tool, arguments: args })) as CallToolResult;
    const index = this.shown++;
    this.servedSet = options.set ?? this.set;
    const request: ShowViewRequest = {
      viewUrl: VIEW_URL,
      hostInfo: this.profile.hostInfo,
      capabilities: this.profile.capabilities,
      hostContext: hostContextFor(this.profile, this.servedSet, { tool: definition, callId: `call_${index + 1}`, width: options.width, displayMode: options.displayMode }),
      toolInput: args,
      toolResult,
    };
    await this.page.evaluate((shown) => window.fakeHost.showView(shown), request);
    return new ViewFrame(this.page, index);
  }

  // A host context change for the view shown last, as a host sends one when the user switches theme or resizes.
  async changeHostContext(change: McpUiHostContext): Promise<void> {
    await this.page.evaluate((changed) => window.fakeHost.changeHostContext(changed), change);
  }

  private async relay(method: string, params: Record<string, unknown>): Promise<unknown> {
    this.calls.push(hostCallOf(method, params));
    if (method === "tools/call") return this.server.callTool({ name: String(params.name), arguments: (params.arguments ?? {}) as Record<string, unknown> });
    // The fake host opens no link and starts no model turn; it only records.
    if (method === "ui/open-link") return { isError: true };
    return {};
  }
}

async function readView(server: Client, tools: Tool[]): Promise<ViewResource> {
  const uris = new Set(tools.map((tool) => getToolUiResourceUri(tool)).filter((uri): uri is string => uri !== undefined));
  if (uris.size !== 1) throw new Error(`Expected one view resource, the server names ${uris.size}: was it started with --app-views-html?`);
  const [uri] = uris;
  const { contents } = await server.readResource({ uri: uri! });
  const content = contents[0];
  if (!content || !("text" in content)) throw new Error(`${uri} has no HTML text`);
  const csp = (content._meta as { ui?: { csp?: McpUiResourceCsp } } | undefined)?.ui?.csp;
  return { html: content.text, csp: viewCsp(csp) };
}
