// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The fake MCP Apps host's page (step 10.17 G5): one iframe per view and
// ext-apps' own AppBridge speaking the MCP Apps protocol to it over
// postMessage, as Claude Desktop and VS Code do. The bridge has no MCP
// client of its own: every request the view makes goes through
// window.mcpHostRelay, which the Playwright side exposes, records, and
// answers (tools/call from the real server over stdio). Built into one
// file by vite.config.ts beside this file; never part of dist/views.html.
import {
  AppBridge,
  PostMessageTransport,
  type McpUiDisplayMode,
  type McpUiHostCapabilities,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface ShowViewRequest {
  viewUrl: string;
  hostInfo: { name: string; version: string };
  capabilities: McpUiHostCapabilities;
  hostContext: McpUiHostContext;
  toolInput: Record<string, unknown>;
  toolResult: CallToolResult;
}

export interface FakeHostPage {
  showView(request: ShowViewRequest): Promise<void>;
  // Goes to the view shown last.
  changeHostContext(change: McpUiHostContext): Promise<void>;
}

declare global {
  interface Window {
    mcpHostRelay(method: string, params: unknown): Promise<unknown>;
    fakeHost: FakeHostPage;
  }
}

const VIEW_TITLE = "MCP App view";
const INLINE_HEIGHT = 200;
const HANDSHAKE_MS = 10_000;

interface ShownView {
  bridge: AppBridge;
  frame: HTMLIFrameElement;
  context: McpUiHostContext;
}

const shown: ShownView[] = [];

// The host's own look: its variables on its document, its ground behind
// the transparent view.
function paintHost(hostContext: McpUiHostContext): void {
  const root = document.documentElement;
  if (hostContext.theme) root.style.colorScheme = hostContext.theme;
  for (const [name, value] of Object.entries(hostContext.styles?.variables ?? {})) if (value) root.style.setProperty(name, value);
  document.body.style.background = "var(--color-background-primary, Canvas)";
}

function placeFrame(iframe: HTMLIFrameElement, hostContext: McpUiHostContext): void {
  const fullscreen = hostContext.displayMode === "fullscreen";
  document.body.classList.toggle("fullscreen", fullscreen);
  const dimensions = (hostContext.containerDimensions ?? {}) as { width?: number };
  iframe.style.width = fullscreen ? "100vw" : dimensions.width ? `${dimensions.width}px` : "100%";
  if (fullscreen) iframe.style.height = "100vh";
}

function maxInlineHeight(view: ShownView): number {
  return ((view.context.containerDimensions ?? {}) as { maxHeight?: number }).maxHeight ?? Number.POSITIVE_INFINITY;
}

async function relayed<T>(method: string, params: unknown): Promise<T> {
  return (await window.mcpHostRelay(method, params)) as T;
}

async function updateView(view: ShownView, change: McpUiHostContext): Promise<void> {
  view.context = { ...view.context, ...change };
  paintHost(view.context);
  placeFrame(view.frame, view.context);
  await view.bridge.sendHostContextChange(change);
}

async function showView(request: ShowViewRequest): Promise<void> {
  paintHost(request.hostContext);
  const iframe = document.createElement("iframe");
  iframe.title = VIEW_TITLE;
  // As a host's sandbox: scripts, on an origin of the view's own.
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
  iframe.style.height = `${INLINE_HEIGHT}px`;
  placeFrame(iframe, request.hostContext);
  document.getElementById("chat")!.append(iframe);

  const bridge = new AppBridge(null, request.hostInfo, request.capabilities, { hostContext: request.hostContext });
  const view: ShownView = { bridge, frame: iframe, context: request.hostContext };
  bridge.oncalltool = (params) => relayed<CallToolResult>("tools/call", params);
  bridge.onmessage = (params) => relayed("ui/message", params);
  bridge.onopenlink = (params) => relayed("ui/open-link", params);
  bridge.onupdatemodelcontext = (params) => relayed("ui/update-model-context", params);
  bridge.onrequestdisplaymode = async (params) => {
    await relayed("ui/request-display-mode", params);
    const offered = (view.context.availableDisplayModes ?? []) as McpUiDisplayMode[];
    if (offered.includes(params.mode) && params.mode !== view.context.displayMode) await updateView(view, { displayMode: params.mode });
    return { mode: view.context.displayMode ?? "inline" };
  };
  bridge.onsizechange = ({ height }) => {
    if (height !== undefined && view.context.displayMode !== "fullscreen") iframe.style.height = `${Math.min(height, maxInlineHeight(view))}px`;
  };
  // A view whose ext-apps rejects the ui/initialize result says nothing and
  // never sends initialized: name the cause instead of a bare test timeout.
  const initialized = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The view never sent ui/notifications/initialized: did its ext-apps reject the host context?")), HANDSHAKE_MS);
    bridge.oninitialized = () => {
      clearTimeout(timer);
      resolve();
    };
  });
  // Listen before the view loads, so its ui/initialize is never missed;
  // the iframe's WindowProxy stays the same across the navigation.
  await bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
  shown.push(view);
  iframe.src = request.viewUrl;
  await initialized;
  await bridge.sendToolInput({ arguments: request.toolInput });
  await bridge.sendToolResult(request.toolResult);
}

async function changeHostContext(change: McpUiHostContext): Promise<void> {
  const latest = shown.at(-1);
  if (!latest) throw new Error("No view is shown");
  await updateView(latest, change);
}

window.fakeHost = { showView, changeHostContext };
