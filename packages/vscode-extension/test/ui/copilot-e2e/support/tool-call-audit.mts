// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Reading a session's tool-call audit (`list_tool_calls`) in the real-Copilot
// specs: has the expected call appeared, and what to say when it did not.
// Pure (unit-tested); the polling is poll-until.mts.

export interface AuditPage {
  total: number;
  calls: { turnIndex?: number; call: { name: string } }[];
}

// The call's name carries the server prefix in some builds, so match the tool name inside it.
export function auditHoldsCall(page: AuditPage, tool: string): boolean {
  return page.total >= 1 && page.calls.some(({ call }) => call.name.includes(tool));
}

// `everything` is the audit without the kind filter. Tool names alone tell the
// two failures apart: Copilot never called the tool (other steps only), or the
// audit did not record a call Copilot made (the owner then checks the debug log).
export function missingToolCallMessage(tool: string, everything: AuditPage, waitedMs: number): string {
  const counts = new Map<string, number>();
  for (const { call } of everything.calls) counts.set(call.name, (counts.get(call.name) ?? 0) + 1);
  const held = [...counts].map(([name, n]) => (n > 1 ? `${name} x${n}` : name)).join(", ");
  const seen = held === "" ? "the audit held no tool call" : `the audit held: ${held}`;
  return (
    `no mcp call to ${tool} in the session's audit after ${Math.round(waitedMs / 1000)} s; ${seen}. ` +
    `If ${tool} is not among them, Copilot never called the tool; if it is listed under another kind, the audit classified it differently; ` +
    `if Copilot's debug log shows the call but the audit does not, the audit did not record it.`
  );
}
