// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// What the view asked the fake host for, in order (step 10.17 G5). Specs
// assert on it: a drill-down is a tool call, never a message to the model
// (A24 2.4, 2.5), and a message is only the fixed template naming a
// session id (mcp-apps.md §4.3, the no-forwarding rule).

export type HostCall =
  | { method: "tools/call"; name: string; arguments: Record<string, unknown> }
  | { method: "ui/message"; texts: string[] }
  | { method: "ui/open-link"; url: string }
  | { method: "ui/request-display-mode"; mode: string }
  | { method: "ui/update-model-context"; params: unknown };

export type RelayedMethod = HostCall["method"];

interface ContentBlock {
  type?: unknown;
  text?: unknown;
}

const textOf = (block: ContentBlock): string => (block.type === "text" && typeof block.text === "string" ? block.text : `[${String(block.type)}]`);

// One request as the bridge received it from the view, by its JSON-RPC method.
export function hostCallOf(method: string, params: Record<string, unknown>): HostCall {
  switch (method) {
    case "tools/call":
      return { method, name: String(params.name), arguments: (params.arguments as Record<string, unknown> | undefined) ?? {} };
    case "ui/message":
      return { method, texts: ((params.content as ContentBlock[] | undefined) ?? []).map(textOf) };
    case "ui/open-link":
      return { method, url: String(params.url) };
    case "ui/request-display-mode":
      return { method, mode: String(params.mode) };
    case "ui/update-model-context":
      return { method, params };
    default:
      throw new Error(`${method} is not relayed by the fake host`);
  }
}

export function toolCallsIn(log: readonly HostCall[]): { name: string; arguments: Record<string, unknown> }[] {
  return log.flatMap((call) => (call.method === "tools/call" ? [{ name: call.name, arguments: call.arguments }] : []));
}

// Everything that would start or feed a model turn.
export function modelTurnsIn(log: readonly HostCall[]): HostCall[] {
  return log.filter((call) => call.method === "ui/message" || call.method === "ui/update-model-context");
}

const ANALYSE_SESSION = /^Analyse session [A-Za-z0-9-]+$/;

// Message texts that are not exactly the "Analyse session <id>" template.
export function messagesOffTemplate(log: readonly HostCall[]): string[] {
  return log.flatMap((call) => (call.method === "ui/message" ? call.texts.filter((text) => !ANALYSE_SESSION.test(text)) : []));
}
