// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { App } from "@modelcontextprotocol/ext-apps";
import type { AppHostPort, DisplayMode, HostContext, ToolResult } from "./app-host-port.js";
import { LatestValue } from "./latest-value.js";

interface ContentBlock {
  type: string;
  text?: string;
}

// The text a tool error carries (an unknown id, a bad argument), which the
// views show as an explained state. Success results carry none: their
// content is the model's text answer, already in the chat.
function errorTextOf(isError: boolean | undefined, content: ContentBlock[] | undefined): { errorText?: string } {
  if (!isError) return {};
  const text = content?.find((block) => block.type === "text" && typeof block.text === "string" && block.text !== "")?.text;
  return text === undefined ? {} : { errorText: text };
}

// The part of ext-apps' App the adapter uses, so tests can pass a fake App.
export interface AppLike {
  ontoolinput: ((params: { arguments?: Record<string, unknown> }) => void) | undefined;
  ontoolresult: ((params: { structuredContent?: unknown; isError?: boolean; content?: ContentBlock[] }) => void) | undefined;
  onhostcontextchanged: ((params: unknown) => void) | undefined;
  getHostContext(): unknown;
  // Optional so a test double can leave it out; the ext-apps App has it.
  getHostCapabilities?(): object | undefined;
  connect(): Promise<void>;
  callServerTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<{ structuredContent?: unknown; isError?: boolean; content?: ContentBlock[] }>;
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
        ...errorTextOf(params.isError, params.content),
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
    return { structuredContent: response.structuredContent, ...(response.isError ? { isError: true } : {}), ...errorTextOf(response.isError, response.content) };
  }

  async openLink(url: string): Promise<boolean> {
    try {
      return !(await this.app.openLink({ url })).isError;
    } catch {
      return false;
    }
  }

  // The host's `message` capability, known once connected. Unknown counts as
  // available, so the button is not hidden before the host has answered.
  canSendMessage(): boolean {
    const capabilities = this.app.getHostCapabilities?.();
    return capabilities === undefined || (capabilities as { message?: unknown }).message !== undefined;
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
