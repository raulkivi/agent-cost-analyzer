// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App.js";
import { GENERIC_BRAND } from "./brand/view-brand.js";
import { FakeAppHostPort } from "./host/fake-app-host-port.js";
import { auditRollup, sessionAudit } from "./view-models/audit-fixtures.js";

// A30: the shell hands get_session_audit and get_audit_rollup to U4 and
// list_sessions to U5, by tool name and by shape.

function open(port: FakeAppHostPort) {
  return render(<App port={port} brand={GENERIC_BRAND} />);
}

describe("App routing for U4 and U5", () => {
  it("hands a get_session_audit result to U4", () => {
    const port = new FakeAppHostPort();
    open(port);
    act(() => {
      port.pushHostContext({ toolInfo: { tool: { name: "get_session_audit" } } });
      port.pushToolResult({ structuredContent: sessionAudit() });
    });
    expect(screen.getByRole("heading", { level: 1, name: "Add retry to export job" })).toBeInTheDocument();
  });

  it("hands a get_audit_rollup result to U4 by shape when the host names no tool", () => {
    const port = new FakeAppHostPort();
    open(port);
    act(() => port.pushToolResult({ structuredContent: auditRollup() }));
    expect(screen.getByRole("heading", { level: 1, name: "Tool-call failures" })).toBeInTheDocument();
  });

  it("hands a list_sessions result to U5, whose Analyse sends one fixed message", async () => {
    const port = new FakeAppHostPort();
    open(port);
    act(() => {
      port.pushHostContext({ toolCall: { toolName: "ai-credits-list_sessions" } });
      port.pushToolResult({ structuredContent: { total: 1, sessions: [{ id: "7f3a9c2e", title: "Refactor", turnCount: 4, model: "m", repositoryKey: null, projectId: null }] } });
    });
    expect(screen.getByRole("heading", { level: 1, name: "Sessions" })).toBeInTheDocument();
    act(() => screen.getByRole("button", { name: "Analyse session 7f3a9c2e" }).click());
    expect(port.calls.filter((call) => call.method === "sendMessage").map((call) => call.args)).toEqual([["Analyse session 7f3a9c2e"]]);
  });
});
