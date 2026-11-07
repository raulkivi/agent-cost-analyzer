// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
/// <reference lib="dom" />
// Phase 12 task A0: the spike view's script (docs/plans/mcp-apps-spike.md).
// Bundled with the ext-apps client into one HTML file by build-spike-view.mts.
// Dev only: not part of the server build or the extension.
import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { buildSpikeReport, type SpikeObservation } from "./report-builder.js";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const observations = new Map<string, SpikeObservation>();
let toolResult: { structuredContent?: unknown; content?: unknown } | undefined;

const app = new App({ name: "aca-spike", version: "0.0.0" }, {});

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function documentTheme(): string {
  return document.documentElement.getAttribute("data-theme") ?? document.documentElement.style.colorScheme ?? "";
}

// The font probe: a face whose only source is local("Barlow Condensed").
// Present if the face loads, or if text set in it measures differently from
// the same text in the fallback alone.
async function probeHeadingFont(): Promise<{ requested: string; available: boolean }> {
  const requested = "Barlow Condensed";
  const loaded = await document.fonts
    .load('24px "Spike Local Heading"', "Session cost 0123")
    .then((faces) => faces.some((face) => face.status === "loaded"))
    .catch(() => false);
  const measure = (family: string): number => {
    const span = document.createElement("span");
    span.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:24px ${family}`;
    span.textContent = "Session cost 0123 WWWiii";
    document.body.appendChild(span);
    const width = span.getBoundingClientRect().width;
    span.remove();
    return width;
  };
  const differs = measure('"Spike Local Heading", monospace') !== measure("monospace");
  return { requested, available: loaded || differs };
}

let headingFont = { requested: "Barlow Condensed", available: false };

function render(): void {
  const hostContext = app.getHostContext() as Record<string, unknown> | undefined;
  const report = buildSpikeReport({
    capturedAt: new Date().toISOString(),
    hostInfo: app.getHostVersion(),
    hostCapabilities: app.getHostCapabilities(),
    hostContext,
    toolResult,
    brandContent: document.querySelector<HTMLMetaElement>('meta[name="aca-brand"]')?.content ?? "",
    headingFont,
    documentTheme: documentTheme(),
    observations: [...observations.values()],
  });
  $("report").textContent = JSON.stringify(report, null, 2);
  $("summary").textContent = [
    `host: ${report.hostInfo?.name ?? "?"} ${report.hostInfo?.version ?? ""}`,
    `theme: host=${report.theme.fromHostContext ?? "none"} document=${report.theme.appliedToDocument || "none"}`,
    `style variables: ${report.styleVariables.count} defined`,
    `host fonts css: ${report.hostFonts.present ? "yes" : "no"}`,
    `toolInfo: ${report.toolInfo.present ? "yes" : "no"}`,
    `display: ${report.displayModes.current ?? "?"} (available: ${report.displayModes.available.join(", ") || "none"})`,
    `local("Barlow Condensed"): ${report.headingFont.available ? "present" : "absent"}`,
    `structuredContent keys: ${report.structuredContentKeys ? report.structuredContentKeys.length : "none"}`,
    `brand: ${report.brand ? "injected" : "MISSING"}`,
  ].join("\n");
}

function record(name: string, outcome: SpikeObservation["outcome"], detail?: string): void {
  const previous = observations.get(name);
  observations.set(name, { name, outcome, ...(detail !== undefined ? { detail } : {}), approvalPromptSeen: previous?.approvalPromptSeen ?? null });
  $(`status-${slug(name)}`).textContent = `${outcome}${detail ? `: ${detail}` : ""}`;
  render();
}

function slug(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, "-");
}

function applyContext(): void {
  const context = app.getHostContext();
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context?.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
}

async function run(name: string, action: () => Promise<unknown>): Promise<void> {
  record(name, "not-run", "running");
  try {
    const result = await action();
    record(name, (result as { isError?: boolean } | undefined)?.isError ? "error" : "ok", JSON.stringify(result)?.slice(0, 300));
  } catch (error) {
    record(name, "error", errorText(error));
  }
}

const TESTS: { name: string; label: string; action: () => Promise<unknown> }[] = [
  { name: "openLink vscode://", label: "openLink vscode:// deep link", action: () => app.openLink({ url: "vscode://raulkivi.ai-credits-analyzer/session?id=test" }) },
  { name: "openLink https://", label: "openLink https:// GitHub", action: () => app.openLink({ url: "https://github.com/raulkivi/agent-cost-analyzer" }) },
  {
    name: "callServerTool get_turn_series",
    label: "callServerTool get_turn_series (app-only tool)",
    action: () => {
      const structured = (toolResult?.structuredContent ?? {}) as { sessionId?: string; providerId?: string };
      if (!structured.sessionId) throw new Error("No sessionId in the tool result; ask the chat 'What did my last session cost?' first.");
      return app.callServerTool({ name: "get_turn_series", arguments: { sessionId: structured.sessionId, ...(structured.providerId ? { provider: structured.providerId } : {}) } });
    },
  },
  { name: "requestDisplayMode fullscreen", label: "requestDisplayMode fullscreen", action: () => app.requestDisplayMode({ mode: "fullscreen" }) },
  { name: "requestDisplayMode inline", label: "requestDisplayMode back to inline", action: () => app.requestDisplayMode({ mode: "inline" }) },
];

function buildControls(): void {
  const rows = $("tests");
  for (const test of TESTS) {
    const row = document.createElement("div");
    row.className = "row";
    const button = document.createElement("button");
    button.textContent = test.label;
    button.addEventListener("click", () => void run(test.name, test.action));
    const status = document.createElement("span");
    status.id = `status-${slug(test.name)}`;
    status.className = "status";
    status.textContent = "not run";
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.addEventListener("change", () => {
      const previous = observations.get(test.name) ?? { name: test.name, outcome: "not-run" as const };
      observations.set(test.name, { ...previous, approvalPromptSeen: box.checked });
      render();
    });
    label.append(box, " the host showed a prompt / confirmation");
    row.append(button, status, label);
    rows.append(row);
  }
}

async function copyReport(): Promise<void> {
  const text = $("report").textContent ?? "";
  try {
    await navigator.clipboard.writeText(text);
    $("copy-status").textContent = "Copied.";
  } catch {
    // Sandboxed iframes often block the async clipboard: select the text so Ctrl+C works.
    const range = document.createRange();
    range.selectNodeContents($("report"));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const copied = (() => {
      try {
        return document.execCommand("copy");
      } catch {
        return false;
      }
    })();
    $("copy-status").textContent = copied ? "Copied (fallback)." : "Clipboard blocked: the report is selected, press Ctrl+C / Cmd+C.";
  }
}

app.ontoolresult = (params) => {
  toolResult = params as { structuredContent?: unknown; content?: unknown };
  render();
};
app.onhostcontextchanged = () => {
  applyContext();
  render();
};

buildControls();
$("copy").addEventListener("click", () => void copyReport());
$("refresh").addEventListener("click", render);

try {
  await app.connect();
  applyContext();
  headingFont = await probeHeadingFont();
} catch (error) {
  $("summary").textContent = `connect failed: ${errorText(error)}`;
}
render();
