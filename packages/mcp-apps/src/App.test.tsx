// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App.js";
import { FakeAppHostPort } from "./host/fake-app-host-port.js";
import { GENERIC_BRAND, type ViewBrand } from "./brand/view-brand.js";

const brand: ViewBrand = { productId: "vscode-extension", displayName: "AI Credits Analyzer", version: "0.9.0" };

describe("App shell", () => {
  it("connects through the port and renders nothing until the host speaks", () => {
    const port = new FakeAppHostPort();
    const { container } = render(<App port={port} brand={brand} />);
    expect(port.connected).toBe(true);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    [{ toolInfo: { tool: { name: "get_session_cost" } } }, "Session cost"],
    [{ toolCall: { toolName: "get_cost_rollup" } }, "Cost rollup"],
    [{ toolInfo: { tool: { name: "list_findings" } } }, "Findings"],
  ])("shows the placeholder view for %j", (context, title) => {
    const port = new FakeAppHostPort();
    render(<App port={port} brand={brand} />);
    act(() => port.pushHostContext(context));
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`AI Credits Analyzer · ${title}`, "i"))).toBeInTheDocument();
  });

  it("routes by result shape when the host names no tool", () => {
    const port = new FakeAppHostPort();
    render(<App port={port} brand={brand} />);
    act(() => port.pushToolResult({ structuredContent: { sessionId: "s", topTurns: [] } }));
    expect(screen.getByRole("heading", { name: "Session cost" })).toBeInTheDocument();
  });

  it("shows a neutral state for an unknown result", () => {
    const port = new FakeAppHostPort();
    render(<App port={port} brand={GENERIC_BRAND} />);
    act(() => port.pushHostContext({ toolInfo: { tool: { name: "get_statement" } } }));
    expect(screen.getByRole("heading", { name: "No view for this result" })).toBeInTheDocument();
  });

  it("picks up context that arrived before the shell subscribed", () => {
    const port = new FakeAppHostPort();
    port.pushHostContext({ toolCall: { toolName: "list_findings" } });
    render(<App port={port} brand={brand} />);
    expect(screen.getByRole("heading", { name: "Findings" })).toBeInTheDocument();
  });
});
