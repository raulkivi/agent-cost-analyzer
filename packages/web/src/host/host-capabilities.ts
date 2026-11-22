// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { HostCommandArgs } from "@agent-cost-analyzer/domain";
import type { ApiTransport } from "../api-client/transport.js";

export type DocumentLanguage = HostCommandArgs["openTextDocument"]["language"];

// What the surrounding host can do for the UI beyond fetching data
// (vscode-extension.md G8). A missing method means the host can't, and the
// UI hides that affordance: the standalone browser app has no editor to
// open a setting or a document in. Components get only the functions they
// need, as props, so none of them knows which product it's in.
export interface HostCapabilities {
  copyToClipboard(text: string): Promise<void>;
  openSetting?(settingId: string): Promise<void>;
  openTextDocument?(text: string, language: DocumentLanguage): Promise<void>;
  // True where the app owns its colours (standalone). The VS Code webview
  // and MCP views keep their host theme, so the colour-mode switch and
  // attribute are off there (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/dense-ledger-ui.md D1).
  colorMode?: boolean;
  // True where the app can show the "Connect an agent" panel (standalone
  // only): it explains the terminal command that registers the MCP server,
  // which means nothing inside the VS Code panel (mcp-client-setup.md §5.6).
  connectAgent?: boolean;
}

interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

// Today's standalone behaviour: the browser's clipboard, looked up when
// copying (so a test's or a late-installed clipboard is honoured).
export function standaloneHostCapabilities(
  clipboard: () => ClipboardWriter = () => navigator.clipboard,
): HostCapabilities {
  return { copyToClipboard: (text) => clipboard().writeText(text), colorMode: true, connectAgent: true };
}

// Every capability as a host command over the transport (the VS Code
// webview), or the standalone set where the transport has no host (HTTP).
export function hostCapabilitiesFor(transport: ApiTransport): HostCapabilities {
  const { command } = transport;
  if (!command) {
    return standaloneHostCapabilities();
  }
  const send = command.bind(transport);
  return {
    copyToClipboard: (text) => send("copyToClipboard", { text }),
    openSetting: (settingId) => send("openSetting", { settingId }),
    openTextDocument: (content, language) => send("openTextDocument", { content, language }),
  };
}
