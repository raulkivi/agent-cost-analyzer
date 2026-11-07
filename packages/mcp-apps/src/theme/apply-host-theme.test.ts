// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { FakeAppHostPort } from "../host/fake-app-host-port.js";
import { bindHostTheme, type ThemeApplier } from "./apply-host-theme.js";

function recordingApplier() {
  const calls: { method: string; arg: unknown }[] = [];
  const applier: ThemeApplier = {
    applyDocumentTheme: (theme) => void calls.push({ method: "theme", arg: theme }),
    applyHostStyleVariables: (variables) => void calls.push({ method: "variables", arg: variables }),
    applyHostFonts: (css) => void calls.push({ method: "fonts", arg: css }),
  };
  return { applier, calls };
}

describe("bindHostTheme", () => {
  it("marks the document as an MCP App before any host context arrives", () => {
    const root = document.createElement("html");
    bindHostTheme(new FakeAppHostPort(), recordingApplier().applier, root);
    expect(root.getAttribute("data-host")).toBe("mcp-app");
  });

  it("applies theme, style variables and fonts from the host context", () => {
    const port = new FakeAppHostPort();
    const { applier, calls } = recordingApplier();
    bindHostTheme(port, applier, document.createElement("html"));
    port.pushHostContext({
      theme: "dark",
      styles: { variables: { "--color-text-primary": "#fff" }, css: { fonts: "@font-face {}" } },
    });
    expect(calls).toEqual([
      { method: "theme", arg: "dark" },
      { method: "variables", arg: { "--color-text-primary": "#fff" } },
      { method: "fonts", arg: "@font-face {}" },
    ]);
  });

  it("applies only what the host sent: any subset is valid", () => {
    const port = new FakeAppHostPort();
    const { applier, calls } = recordingApplier();
    bindHostTheme(port, applier, document.createElement("html"));
    port.pushHostContext({ toolCall: { toolName: "get_session_cost" } });
    port.pushHostContext({ theme: "light" });
    port.pushHostContext({ styles: { variables: {} } });
    expect(calls).toEqual([
      { method: "theme", arg: "light" },
      { method: "variables", arg: {} },
    ]);
  });

  it("applies a context that arrived before binding, and follows later theme changes", () => {
    const port = new FakeAppHostPort();
    port.pushHostContext({ theme: "light" });
    const { applier, calls } = recordingApplier();
    bindHostTheme(port, applier, document.createElement("html"));
    port.pushHostContext({ theme: "dark" });
    expect(calls.map((call) => call.arg)).toEqual(["light", "dark"]);
  });

  it("stops applying once unsubscribed", () => {
    const port = new FakeAppHostPort();
    const { applier, calls } = recordingApplier();
    const stop = bindHostTheme(port, applier, document.createElement("html"));
    stop();
    port.pushHostContext({ theme: "dark" });
    expect(calls).toEqual([]);
  });
});
