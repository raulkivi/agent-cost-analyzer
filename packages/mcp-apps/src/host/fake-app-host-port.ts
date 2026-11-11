// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { AppHostPort, DisplayMode, HostContext, ToolResult } from "./app-host-port.js";
import { LatestValue } from "./latest-value.js";

// Test double: records calls and lets a test push host events.
export class FakeAppHostPort implements AppHostPort {
  readonly calls: { method: string; args: unknown[] }[] = [];
  toolResults = new Map<string, ToolResult>();
  openLinkResult = true;
  sendMessageResult = true;
  // false: a host that explicitly said it cannot send chat messages (U2 and U5 show what to type instead).
  messagingAvailable = true;
  connected = false;
  // The host's latest context, merged: a host may send any subset of fields.
  private hostContext: HostContext = {};
  private readonly context = new LatestValue<HostContext>();
  private readonly input = new LatestValue<Record<string, unknown>>();
  private readonly result = new LatestValue<ToolResult>();

  pushHostContext(context: HostContext): void {
    this.hostContext = { ...this.hostContext, ...context };
    this.context.publish(context);
  }
  pushToolInput(args: Record<string, unknown>): void {
    this.input.publish(args);
  }
  pushToolResult(result: ToolResult): void {
    this.result.publish(result);
  }

  async connect(): Promise<void> {
    this.calls.push({ method: "connect", args: [] });
    this.connected = true;
  }
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    this.calls.push({ method: "callTool", args: [name, args] });
    return this.toolResults.get(name) ?? { isError: true };
  }
  async openLink(url: string): Promise<boolean> {
    this.calls.push({ method: "openLink", args: [url] });
    return this.openLinkResult;
  }
  canSendMessage(): boolean {
    return this.messagingAvailable;
  }
  async sendMessage(text: string): Promise<boolean> {
    this.calls.push({ method: "sendMessage", args: [text] });
    return this.sendMessageResult;
  }
  // Like a host: a listed mode takes effect and is pushed back in the
  // context; an unlisted one is declined, and the current mode is returned.
  async requestDisplayMode(mode: DisplayMode): Promise<DisplayMode> {
    this.calls.push({ method: "requestDisplayMode", args: [mode] });
    if (this.hostContext.availableDisplayModes?.includes(mode)) {
      this.hostContext = { ...this.hostContext, displayMode: mode };
      this.context.publish({ displayMode: mode });
    }
    return this.hostContext.displayMode ?? "inline";
  }
  onHostContext: AppHostPort["onHostContext"] = (listener) => this.context.subscribe(listener);
  onToolInput: AppHostPort["onToolInput"] = (listener) => this.input.subscribe(listener);
  onToolResult: AppHostPort["onToolResult"] = (listener) => this.result.subscribe(listener);
}
