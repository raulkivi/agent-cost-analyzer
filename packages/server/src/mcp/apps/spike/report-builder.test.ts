// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { buildSpikeReport, parseBrandContent, type SpikeReportInput } from "./report-builder.js";

const base: SpikeReportInput = {
  capturedAt: "2026-11-07T10:00:00.000Z",
  hostInfo: { name: "VS Code", version: "1.109.0" },
  hostContext: undefined,
  toolResult: undefined,
  brandContent: "",
  headingFont: { requested: "Barlow Condensed", available: false },
  documentTheme: "light",
  observations: [],
};

describe("parseBrandContent", () => {
  it("parses the injected JSON", () => {
    expect(parseBrandContent('{"productId":"standalone","displayName":"X","version":"1"}')).toEqual({ productId: "standalone", displayName: "X", version: "1" });
  });

  it("returns null for the empty placeholder and for junk", () => {
    expect(parseBrandContent("")).toBeNull();
    expect(parseBrandContent("{nope")).toBeNull();
  });
});

describe("buildSpikeReport", () => {
  it("records a bare host context as absent, not as empty", () => {
    const r = buildSpikeReport(base);
    expect(r.styleVariables).toEqual({ count: 0, defined: {}, undefinedNames: [] });
    expect(r.toolInfo).toEqual({ present: false });
    expect(r.hostFonts).toEqual({ present: false });
    expect(r.theme).toEqual({ fromHostContext: null, appliedToDocument: "light" });
    expect(r.displayModes).toEqual({ current: null, available: [] });
    expect(r.structuredContentKeys).toBeNull();
    expect(r.brand).toBeNull();
  });

  it("splits defined and undefined host variables and sorts names", () => {
    const r = buildSpikeReport({
      ...base,
      hostContext: { styles: { variables: { "--font-sans": "Segoe UI", "--color-text-primary": "#fff", "--shadow-sm": undefined } }, theme: "dark" },
    });
    expect(r.styleVariables.count).toBe(2);
    expect(Object.keys(r.styleVariables.defined)).toEqual(["--color-text-primary", "--font-sans"]);
    expect(r.styleVariables.undefinedNames).toEqual(["--shadow-sm"]);
    expect(r.theme.fromHostContext).toBe("dark");
  });

  it("records host fonts css and its length", () => {
    const r = buildSpikeReport({ ...base, hostContext: { styles: { css: { fonts: "@font-face{font-family:X}" } } } });
    expect(r.hostFonts).toEqual({ present: true, css: "@font-face{font-family:X}", length: 25 });
  });

  it("records toolInfo content", () => {
    const toolInfo = { id: 7, tool: { name: "get_session_cost", inputSchema: { type: "object" } } };
    const r = buildSpikeReport({ ...base, hostContext: { toolInfo } });
    expect(r.toolInfo).toEqual({ present: true, id: 7, toolName: "get_session_cost", content: toolInfo });
  });

  it("records display modes, the structuredContent keys and the brand", () => {
    const r = buildSpikeReport({
      ...base,
      hostContext: { displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"] },
      toolResult: { structuredContent: { sessionId: "s1", totals: {}, title: "t" }, content: [{ type: "text", text: "hi" }] },
      brandContent: '{"productId":"standalone","displayName":"Agent Cost Analyzer","version":"0.9.0"}',
    });
    expect(r.displayModes).toEqual({ current: "inline", available: ["inline", "fullscreen"] });
    expect(r.structuredContentKeys).toEqual(["sessionId", "title", "totals"]);
    expect(r.brand).toEqual({ productId: "standalone", displayName: "Agent Cost Analyzer", version: "0.9.0" });
  });

  it("carries other host context fields and observations through", () => {
    const r = buildSpikeReport({
      ...base,
      hostContext: { platform: "desktop", containerDimensions: { maxHeight: 600 }, locale: "en-US", userAgent: "vscode", styles: { variables: {} } },
      observations: [{ name: "openLink vscode://", outcome: "error", detail: "denied", approvalPromptSeen: null }],
    });
    expect(r.otherHostContext).toEqual({ platform: "desktop", containerDimensions: { maxHeight: 600 }, locale: "en-US", userAgent: "vscode" });
    expect(r.observations).toEqual([{ name: "openLink vscode://", outcome: "error", detail: "denied", approvalPromptSeen: null }]);
    expect(r.hostInfo).toEqual({ name: "VS Code", version: "1.109.0" });
  });

  it("is JSON-serialisable", () => {
    expect(() => JSON.stringify(buildSpikeReport(base))).not.toThrow();
  });
});
