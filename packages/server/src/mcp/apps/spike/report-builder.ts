// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// Phase 12 task A0 (docs/plans/mcp-apps-spike.md): turns what the spike view
// observed in a host into the JSON report the owner pastes back. Pure: no
// DOM, no ext-apps import, so it is unit-tested and bundled into the view.

export interface SpikeObservation {
  name: string;
  outcome: "ok" | "error" | "not-run";
  detail?: string;
  // Answered by the owner through a checkbox; null = not answered.
  approvalPromptSeen?: boolean | null;
}

type Dict = Record<string, unknown>;

export interface SpikeReportInput {
  capturedAt: string;
  hostInfo?: { name?: string; version?: string };
  hostCapabilities?: unknown;
  hostContext: Dict | undefined;
  toolResult: { structuredContent?: unknown; content?: unknown } | undefined;
  brandContent: string;
  headingFont: { requested: string; available: boolean };
  documentTheme: string;
  observations: SpikeObservation[];
}

export interface SpikeReport {
  capturedAt: string;
  hostInfo: { name?: string; version?: string } | null;
  hostCapabilities: unknown;
  theme: { fromHostContext: string | null; appliedToDocument: string };
  styleVariables: { count: number; defined: Record<string, string>; undefinedNames: string[] };
  hostFonts: { present: false } | { present: true; css: string; length: number };
  toolInfo: { present: false } | { present: true; id: unknown; toolName: string | null; content: unknown };
  displayModes: { current: string | null; available: string[] };
  otherHostContext: Dict;
  structuredContentKeys: string[] | null;
  contentBlockCount: number | null;
  brand: unknown;
  headingFont: { requested: string; available: boolean };
  observations: SpikeObservation[];
}

// Host-context keys with their own section in the report; the rest are
// carried through as otherHostContext.
const REPORTED_SEPARATELY = new Set(["styles", "theme", "toolInfo", "displayMode", "availableDisplayModes"]);

export function parseBrandContent(content: string): unknown {
  if (!content) return null;
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return null;
  }
}

function isDict(value: unknown): value is Dict {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildSpikeReport(input: SpikeReportInput): SpikeReport {
  const context = input.hostContext ?? {};
  const styles = isDict(context.styles) ? context.styles : {};

  const defined: Record<string, string> = {};
  const undefinedNames: string[] = [];
  if (isDict(styles.variables)) {
    for (const name of Object.keys(styles.variables).sort()) {
      const value = styles.variables[name];
      if (typeof value === "string") defined[name] = value;
      else undefinedNames.push(name);
    }
  }

  const fonts = isDict(styles.css) && typeof styles.css.fonts === "string" && styles.css.fonts !== "" ? styles.css.fonts : undefined;

  const toolInfo = isDict(context.toolInfo) ? context.toolInfo : undefined;
  const tool = toolInfo && isDict(toolInfo.tool) ? toolInfo.tool : undefined;

  const structured = input.toolResult?.structuredContent;

  return {
    capturedAt: input.capturedAt,
    hostInfo: input.hostInfo ?? null,
    hostCapabilities: input.hostCapabilities ?? null,
    theme: { fromHostContext: typeof context.theme === "string" ? context.theme : null, appliedToDocument: input.documentTheme },
    styleVariables: { count: Object.keys(defined).length, defined, undefinedNames },
    hostFonts: fonts === undefined ? { present: false } : { present: true, css: fonts, length: fonts.length },
    toolInfo: toolInfo
      ? { present: true, id: toolInfo.id, toolName: typeof tool?.name === "string" ? tool.name : null, content: toolInfo }
      : { present: false },
    displayModes: {
      current: typeof context.displayMode === "string" ? context.displayMode : null,
      available: Array.isArray(context.availableDisplayModes) ? context.availableDisplayModes.filter((m): m is string => typeof m === "string") : [],
    },
    otherHostContext: Object.fromEntries(Object.entries(context).filter(([key]) => !REPORTED_SEPARATELY.has(key))),
    structuredContentKeys: isDict(structured) ? Object.keys(structured).sort() : null,
    contentBlockCount: Array.isArray(input.toolResult?.content) ? input.toolResult.content.length : null,
    brand: parseBrandContent(input.brandContent),
    headingFont: input.headingFont,
    observations: input.observations,
  };
}
