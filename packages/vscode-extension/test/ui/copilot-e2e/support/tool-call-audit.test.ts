// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { auditHoldsCall, missingToolCallMessage, type AuditPage } from "./tool-call-audit.mts";

const page = (...names: string[]): AuditPage => ({ total: names.length, calls: names.map((name) => ({ turnIndex: 0, call: { name } })) });

describe("auditHoldsCall", () => {
  it("holds when a call names the tool, whatever the server prefix", () => {
    expect(auditHoldsCall(page("mcp_ai-credits-analyzer_list_log_providers"), "list_log_providers")).toBe(true);
  });

  it("does not hold on an empty audit or another tool", () => {
    expect(auditHoldsCall(page(), "list_log_providers")).toBe(false);
    expect(auditHoldsCall(page("list_sessions"), "list_log_providers")).toBe(false);
  });
});

describe("missingToolCallMessage", () => {
  it("lists the tool names of the whole audit and the wait, so a failure says who missed the call", () => {
    const message = missingToolCallMessage("list_sessions", page("manage_todo_list", "tool_search", "manage_todo_list"), 90_000);
    expect(message).toContain("no mcp call to list_sessions");
    expect(message).toContain("after 90 s");
    expect(message).toContain("manage_todo_list x2, tool_search");
    expect(message).toContain("Copilot never called the tool");
  });

  it("says the audit was empty when it holds no call at all", () => {
    expect(missingToolCallMessage("list_sessions", page(), 90_000)).toContain("the audit held no tool call");
  });
});
