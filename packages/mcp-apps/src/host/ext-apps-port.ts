// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { App } from "@modelcontextprotocol/ext-apps";
import type { AppHostPort, DisplayMode, HostContext, ToolResult } from "./app-host-port.js";
import { LatestValue } from "./latest-value.js";

// The part of ext-apps' App the adapter uses, so tests can pass a fake App.
export interface AppLike {
  ontoolinput: ((params: { arguments?: Record<string, unknown> }) => void) | undefined;
  ontoolresult: ((params: { structuredContent?: unknown; isError?: boolean }) => void) | undefined;
  onhostcontextchanged: ((params: unknown) => void) | undefined;
  getHostContext(): unknown;
  connect(): Promise<void>;
  callServerTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<{ structuredContent?: unknown; isError?: boolean }>;
  openLink(params: { url: string }): Promise<{ isError?: boolean }>;
  sendMessage(params: { role: "user"; content: { type: "text"; text: string }[] }): Promise<{ isError?: boolean }>;
  requestDisplayMode(params: { mode: DisplayMode }): Promise<{ mode: DisplayMode }>;
}

export class ExtAppsHostPort implements AppHostPort {
  private readonly context = new LatestValue<HostContext>();
  private readonly input = new LatestValue<Record<string, unknown>>();
  private readonly result = new LatestValue<ToolResult>();

  constructor(private readonly app: AppLike) {
    // Handlers are set before connect() so no early notification is missed.
    app.ontoolinput = (params) => this.input.publish(params.arguments ?? {});
    app.ontoolresult = (params) =>
      this.result.publish({
        structuredContent: params.structuredContent,
        ...(params.isError !== undefined ? { isError: params.isError } : {}),
      });
    app.onhostcontextchanged = () => this.publishContext();
  }

  private publishContext(): void {
    const context = this.app.getHostContext();
    if (context && typeof context === "object") this.context.publish(context as HostContext);
  }

  async connect(): Promise<void> {
    await this.app.connect();
    this.publishContext();
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const response = await this.app.callServerTool({ name, arguments: args });
    return { structuredContent: response.structuredContent, ...(response.isError ? { isError: true } : {}) };
  }

  async openLink(url: string): Promise<boolean> {
    try {
      return !(await this.app.openLink({ url })).isError;
    } catch {
      return false;
    }
  }

  async sendMessage(text: string): Promise<boolean> {
    try {
      return !(await this.app.sendMessage({ role: "user", content: [{ type: "text", text }] })).isError;
    } catch {
      return false;
    }
  }

  async requestDisplayMode(mode: DisplayMode): Promise<DisplayMode> {
    try {
      return (await this.app.requestDisplayMode({ mode })).mode;
    } catch {
      return (this.app.getHostContext() as HostContext | undefined)?.displayMode ?? "inline";
    }
  }

  onHostContext: AppHostPort["onHostContext"] = (listener) => this.context.subscribe(listener);
  onToolInput: AppHostPort["onToolInput"] = (listener) => this.input.subscribe(listener);
  onToolResult: AppHostPort["onToolResult"] = (listener) => this.result.subscribe(listener);
}

export function createExtAppsHostPort(name: string, version: string): AppHostPort {
  // autoResize is on by default; the inline height cap is the view's CSS.
  return new ExtAppsHostPort(new App({ name, version }, {}) as unknown as AppLike);
}
