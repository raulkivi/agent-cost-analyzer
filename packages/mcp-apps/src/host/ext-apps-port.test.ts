// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";
import { ExtAppsHostPort, type AppLike } from "./ext-apps-port.js";
import type { HostContext } from "./app-host-port.js";

function fakeApp(overrides: Partial<AppLike> = {}): AppLike & { context: unknown } {
  const app = {
    context: undefined as unknown,
    ontoolinput: undefined,
    ontoolresult: undefined,
    onhostcontextchanged: undefined,
    getHostContext() {
      return app.context;
    },
    connect: vi.fn(async () => undefined),
    callServerTool: vi.fn(async () => ({ structuredContent: { ok: 1 } })),
    openLink: vi.fn(async () => ({})),
    sendMessage: vi.fn(async () => ({})),
    requestDisplayMode: vi.fn(async ({ mode }: { mode: "inline" | "fullscreen" | "pip" }) => ({ mode })),
    ...overrides,
  } as AppLike & { context: unknown };
  return app;
}

describe("ExtAppsHostPort", () => {
  it("maps callTool to callServerTool and returns the structured content", async () => {
    const app = fakeApp();
    const port = new ExtAppsHostPort(app);
    await expect(port.callTool("get_turn", { sessionId: "s" })).resolves.toEqual({ structuredContent: { ok: 1 } });
    expect(app.callServerTool).toHaveBeenCalledWith({ name: "get_turn", arguments: { sessionId: "s" } });
  });

  it("flags error results", async () => {
    const app = fakeApp({ callServerTool: vi.fn(async () => ({ isError: true })) });
    await expect(new ExtAppsHostPort(app).callTool("x", {})).resolves.toMatchObject({ isError: true });
  });

  it("keeps the first text of an error result as errorText, and none for a success", async () => {
    const content = [{ type: "text", text: 'Unknown project id "x". No projects here.' }, { type: "text", text: "second" }];
    const app = fakeApp({ callServerTool: vi.fn(async () => ({ isError: true, content })) });
    await expect(new ExtAppsHostPort(app).callTool("x", {})).resolves.toEqual({ isError: true, errorText: 'Unknown project id "x". No projects here.' });
    const ok = fakeApp({ callServerTool: vi.fn(async () => ({ structuredContent: { a: 1 }, content })) });
    await expect(new ExtAppsHostPort(ok).callTool("x", {})).resolves.toEqual({ structuredContent: { a: 1 } });
  });

  it("delivers a pushed error result with its text, skipping non-text content", () => {
    const app = fakeApp();
    const port = new ExtAppsHostPort(app);
    const seen: unknown[] = [];
    port.onToolResult((result) => seen.push(result));
    app.ontoolresult?.({ isError: true, content: [{ type: "image" }, { type: "text", text: "boom" }] });
    app.ontoolresult?.({ isError: true, content: [] });
    expect(seen).toEqual([{ structuredContent: undefined, isError: true, errorText: "boom" }, { structuredContent: undefined, isError: true }]);
  });

  it("maps openLink and sendMessage, and reports host refusal or failure as false", async () => {
    const app = fakeApp();
    const port = new ExtAppsHostPort(app);
    await expect(port.openLink("vscode://x/session?id=1")).resolves.toBe(true);
    expect(app.openLink).toHaveBeenCalledWith({ url: "vscode://x/session?id=1" });
    await expect(port.sendMessage("Explain session s1")).resolves.toBe(true);
    expect(app.sendMessage).toHaveBeenCalledWith({ role: "user", content: [{ type: "text", text: "Explain session s1" }] });

    const refusing = new ExtAppsHostPort(
      fakeApp({ openLink: vi.fn(async () => ({ isError: true })), sendMessage: vi.fn(async () => { throw new Error("no"); }) }),
    );
    await expect(refusing.openLink("https://x")).resolves.toBe(false);
    await expect(refusing.sendMessage("t")).resolves.toBe(false);
  });

  // Owner, 2026-11-11 (§9.2 Q7): try, then fall back. VS Code advertises no
  // `message` capability yet sends, so only an explicit "no" hides the affordance.
  it("reports chat messages as available unless the host explicitly says it cannot send them", () => {
    expect(new ExtAppsHostPort(fakeApp()).canSendMessage()).toBe(true);
    expect(new ExtAppsHostPort(fakeApp({ getHostCapabilities: () => undefined })).canSendMessage()).toBe(true);
    expect(new ExtAppsHostPort(fakeApp({ getHostCapabilities: () => ({ message: { text: {} } }) })).canSendMessage()).toBe(true);
    // VS Code's recorded capabilities (mcp-apps-spike-results/vscode-dark.json): no `message`, yet U2's message was sent (A16).
    expect(new ExtAppsHostPort(fakeApp({ getHostCapabilities: () => ({ openLinks: {}, serverTools: { listChanged: true }, updateModelContext: {} }) })).canSendMessage()).toBe(true);
    expect(new ExtAppsHostPort(fakeApp({ getHostCapabilities: () => ({ openLinks: {}, message: false }) })).canSendMessage()).toBe(false);
  });

  it("returns the mode the host granted, or the current one when the request fails", async () => {
    const app = fakeApp({ requestDisplayMode: vi.fn(async () => ({ mode: "inline" as const })) });
    await expect(new ExtAppsHostPort(app).requestDisplayMode("fullscreen")).resolves.toBe("inline");
    const failing = fakeApp({ requestDisplayMode: vi.fn(async () => { throw new Error("x"); }) });
    failing.context = { displayMode: "pip" };
    await expect(new ExtAppsHostPort(failing).requestDisplayMode("fullscreen")).resolves.toBe("pip");
  });

  it("publishes host context after connect and on change, replaying the latest to late listeners", async () => {
    const app = fakeApp();
    const port = new ExtAppsHostPort(app);
    app.context = { toolCall: { toolName: "list_findings" } };
    await port.connect();
    const seen: HostContext[] = [];
    port.onHostContext((c) => seen.push(c));
    expect(seen).toEqual([{ toolCall: { toolName: "list_findings" } }]);
    app.context = { theme: "dark" };
    app.onhostcontextchanged?.({});
    expect(seen.at(-1)).toEqual({ theme: "dark" });
  });

  it("delivers tool input and results that arrive before subscription", () => {
    const app = fakeApp();
    const port = new ExtAppsHostPort(app);
    app.ontoolinput?.({ arguments: { since: "2026-01-01" } });
    app.ontoolresult?.({ structuredContent: { total: 0 } });
    const inputs: unknown[] = [];
    const results: unknown[] = [];
    const stop = port.onToolInput((a) => inputs.push(a));
    port.onToolResult((r) => results.push(r));
    expect(inputs).toEqual([{ since: "2026-01-01" }]);
    expect(results).toEqual([{ structuredContent: { total: 0 } }]);
    stop();
    app.ontoolinput?.({ arguments: {} });
    expect(inputs).toHaveLength(1);
  });
});
