// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hostCallOf, messagesOffTemplate, modelTurnsIn, toolCallsIn, type HostCall } from "./call-log.js";

describe("hostCallOf", () => {
  it("records a tool call by name and arguments", () => {
    expect(hostCallOf("tools/call", { name: "get_project_cost", arguments: { projectId: "portal" } })).toEqual({
      method: "tools/call",
      name: "get_project_cost",
      arguments: { projectId: "portal" },
    });
  });

  it("records a tool call without arguments as an empty object", () => {
    expect(hostCallOf("tools/call", { name: "list_projects" })).toEqual({ method: "tools/call", name: "list_projects", arguments: {} });
  });

  it("records a message by its text blocks, and a non-text block by its type", () => {
    expect(
      hostCallOf("ui/message", { role: "user", content: [{ type: "text", text: "Analyse session c1" }, { type: "image", data: "", mimeType: "image/png" }] }),
    ).toEqual({ method: "ui/message", texts: ["Analyse session c1", "[image]"] });
  });

  it("records a link, a display-mode request and a model-context update", () => {
    expect(hostCallOf("ui/open-link", { url: "https://example.com" })).toEqual({ method: "ui/open-link", url: "https://example.com" });
    expect(hostCallOf("ui/request-display-mode", { mode: "fullscreen" })).toEqual({ method: "ui/request-display-mode", mode: "fullscreen" });
    expect(hostCallOf("ui/update-model-context", { content: [{ type: "text", text: "x" }] })).toEqual({
      method: "ui/update-model-context",
      params: { content: [{ type: "text", text: "x" }] },
    });
  });

  it("refuses a method the host does not relay", () => {
    expect(() => hostCallOf("sampling/createMessage", {})).toThrow(/not relayed/);
  });
});

const LOG: HostCall[] = [
  { method: "tools/call", name: "get_project_cost", arguments: { projectId: "portal" } },
  { method: "ui/request-display-mode", mode: "fullscreen" },
  { method: "tools/call", name: "get_session_cost", arguments: { sessionId: "c1" } },
  { method: "ui/message", texts: ["Analyse session c0000000-0000-4000-8000-000000000002"] },
];

describe("toolCallsIn", () => {
  it("lists the tool calls in order, by name and arguments", () => {
    expect(toolCallsIn(LOG)).toEqual([
      { name: "get_project_cost", arguments: { projectId: "portal" } },
      { name: "get_session_cost", arguments: { sessionId: "c1" } },
    ]);
  });
});

describe("modelTurnsIn", () => {
  it("lists what reaches the model: messages and model-context updates, never tool calls", () => {
    expect(modelTurnsIn(LOG)).toEqual([LOG[3]]);
    expect(modelTurnsIn([...LOG, { method: "ui/update-model-context", params: {} }])).toHaveLength(2);
    expect(modelTurnsIn(LOG.slice(0, 3))).toEqual([]);
  });
});

describe("messagesOffTemplate", () => {
  it("accepts only the fixed template naming a session id", () => {
    expect(messagesOffTemplate(LOG)).toEqual([]);
  });

  it("returns any other text, including a template with logged text after the id", () => {
    const log: HostCall[] = [
      { method: "ui/message", texts: ["Analyse session c1: Refactor the provider registry"] },
      { method: "ui/message", texts: ["Analyse session c1", "Placeholder prompt 1."] },
      { method: "ui/message", texts: ["What did this cost?"] },
    ];
    expect(messagesOffTemplate(log)).toEqual(["Analyse session c1: Refactor the provider registry", "Placeholder prompt 1.", "What did this cost?"]);
  });
});
