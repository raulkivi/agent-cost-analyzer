// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The fixed prompt of the G4 view specs (step 10.17): one chat in which
// Copilot calls every analyzer tool whose MCP App view a spec reads, all in
// one step, so the run stays within a couple of AI Credits (owner decision
// D8). Each tool call renders its own view under it.

export interface ViewCall {
  tool: string;
  args: Record<string, unknown>;
}

export function viewsPrompt(calls: readonly ViewCall[]): string {
  if (calls.length === 0) throw new Error("The views prompt needs at least one tool call");
  return [
    `Call these ${calls.length === 1 ? "" : `all ${calls.length} `}ai-credits-analyzer MCP tools in parallel, in one step, each exactly once with exactly these JSON arguments, and nothing else:`,
    ...calls.map((call, index) => `${index + 1}. ${call.tool} ${JSON.stringify(call.args)}`),
    "Do not summarise the results; reply with the single word: done",
  ].join("\n");
}
