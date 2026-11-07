// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";
import { MAX_COMPARED_MODELS, sessionReplayComparisonSchema, sessionReplaySchema } from "./session-replay.js";

// The ApiService method names (vscode-extension.md D2/§4), shared by the
// server, the web app's transports and the extension's dispatcher so the
// webview RPC's allow-list can't drift from the service. Names only — the
// transports themselves live in their own packages.
export const apiMethodSchema = z.enum([
  "listSessions",
  "getSession",
  "getTurnDetail",
  "getSystemPromptText",
  "getConfigStatus",
  "setRetentionThreshold",
  "listLearnScenarios",
  "getLearnScenario",
  "getScenario",
  "compareScenario",
  "listVendorProfiles",
  "getLogProviderStatus",
  "setActiveLogProvider",
  "getSessionAudit",
  "listToolCalls",
  "getAuditRollup",
  "getInsights",
  "getHealth",
  "getProductProfile",
  // Phase 15 step 15.9: the Dashboard's Cost over time and Compare tabs.
  "getCostTimeSeries",
  "getCostComparison",
  // Phase 15 step 15.10: the Dashboard's Project tab.
  "getProjectCost",
  "getCostVariance",
  // Phase 15 step 15.11: billing statements; issuing writes a file.
  "getStatement",
  "issueStatement",
  // Phase 15 step 15.11: the Projects editor (saveProjects writes the file).
  "getProjects",
  "saveProjects",
  "getRepositoryList",
  // Phase 15 step 15.12: the Billing tab's estimate panel.
  "getCostEstimate",
  // Phase 14 step 14.5: a session replayed on other models. Read-only.
  "getSessionReplay",
  "compareSessionReplay",
]);

export type ApiMethod = z.infer<typeof apiMethodSchema>;

// Params per method, under the keys the web transports send
// (packages/web/src/api-client/http-transport.ts). These check shape only —
// types and required ids — so the extension host can reject a malformed
// request from the untrusted webview with a 400. Value rules stay in
// ApiService (the turn index, the retention value, the provider id, the
// query parsers), which is what keeps the HTTP API's messages the single
// source of truth; the fields it validates are left `unknown` here.
const noParams = z.object({});
const idParams = z.object({ id: z.string().min(1) });
const sessionIdSchema = z.string().min(1);
const numberOrText = z.union([z.number(), z.string()]);
const textOrList = z.union([z.string(), z.array(z.string())]);

const rangeQuery = {
  since: z.string().optional(),
  until: z.string().optional(),
  limit: numberOrText.optional(),
  provider: z.string().optional(),
};

// The cost analyses' query (GET /api/cost/timeseries, /api/cost/compare):
// text fields as sent, ids as a list or a comma-separated string. Values are
// ApiService's (cost-query-params.ts).
const costQuery = {
  ...rangeQuery,
  bucket: z.string().optional(),
  basis: z.string().optional(),
  pricing: z.string().optional(),
  currency: z.string().optional(),
  groupBy: z.string().optional(),
  ids: textOrList.optional(),
};

// Phase 14 step 14.5 (threat-model.md "RPC allow-list growth (Phase 14)"):
// the replay routes' params and limits. Unlike the older methods these are
// strict — a model id is bounded text, at most MAX_COMPARED_MODELS of them,
// the pricing one of three — and ApiService checks the ids again against
// the vendor profiles.
export const MAX_REPLAY_MODEL_ID_LENGTH = 100;
const replayModelId = z.string().min(1).max(MAX_REPLAY_MODEL_ID_LENGTH);
const replayQuery = {
  sessionId: sessionIdSchema,
  pricing: z.enum(["session-channel", "copilot", "api"]).optional(),
  provider: z.string().optional(),
};

export const apiMethodParamsSchemas = {
  listSessions: noParams,
  getSession: idParams,
  getTurnDetail: z.object({ sessionId: sessionIdSchema, turnIndex: z.unknown().optional() }),
  getSystemPromptText: idParams,
  getConfigStatus: noParams,
  setRetentionThreshold: z.object({ value: z.unknown().optional() }),
  listLearnScenarios: noParams,
  getLearnScenario: idParams,
  getScenario: z.object({ id: z.string().min(1), modelId: z.string().optional() }),
  compareScenario: z.object({ id: z.string().min(1), modelIds: z.array(z.string()).optional() }),
  listVendorProfiles: noParams,
  getLogProviderStatus: noParams,
  setActiveLogProvider: z.object({ id: z.unknown().optional() }),
  getSessionAudit: z.object({ sessionId: sessionIdSchema, provider: z.string().optional() }),
  listToolCalls: z.object({
    sessionId: sessionIdSchema,
    status: textOrList.optional(),
    category: textOrList.optional(),
    tool: z.string().optional(),
    kind: textOrList.optional(),
    program: z.string().optional(),
    turn: numberOrText.optional(),
    offset: numberOrText.optional(),
    limit: numberOrText.optional(),
    provider: z.string().optional(),
  }),
  getAuditRollup: z.object(rangeQuery),
  getInsights: z.object(rangeQuery),
  getHealth: noParams,
  getProductProfile: noParams,
  getCostTimeSeries: z.object(costQuery),
  getCostComparison: z.object({ ...costQuery, comparePeriod: z.string().optional() }),
  getProjectCost: z.object({ ...costQuery, projectId: z.string().min(1), topSessions: numberOrText.optional() }),
  getStatement: z.object({ projectId: z.string().min(1), period: z.string().min(1), provider: z.string().optional(), limit: numberOrText.optional() }),
  issueStatement: z.object({ projectId: z.string().min(1), period: z.string().min(1) }),
  getProjects: noParams,
  // ApiService validates the file itself (projectsFileSchema).
  saveProjects: z.object({ file: z.unknown() }),
  getRepositoryList: noParams,
  getCostEstimate: z.object({
    projectId: z.string().optional(),
    repository: z.string().optional(),
    activeDays: numberOrText.optional(),
    sessions: numberOrText.optional(),
    historyWeeks: numberOrText.optional(),
    provider: z.string().optional(),
  }),
  getSessionReplay: z.object({ ...replayQuery, model: replayModelId }).strict(),
  compareSessionReplay: z.object({ ...replayQuery, models: z.array(replayModelId).min(1).max(MAX_COMPARED_MODELS) }).strict(),
  getCostVariance: z.object({
    groupBy: z.string(),
    id: z.string().min(1),
    periodA: z.string(),
    periodB: z.string(),
    currency: z.string().optional(),
    provider: z.string().optional(),
    limit: numberOrText.optional(),
  }),
} as const satisfies Record<ApiMethod, z.ZodType>;

// The answers the web api-client parses before use, so a backend that drifts
// from the domain shapes fails loudly rather than rendering wrong figures.
export const apiMethodResultSchemas = {
  getSessionReplay: sessionReplaySchema,
  compareSessionReplay: sessionReplayComparisonSchema,
} as const satisfies Partial<Record<ApiMethod, z.ZodType>>;

// webview -> host (vscode-extension.md §4). `params` stays unknown here: the
// host validates it per method with apiMethodParamsSchemas.
export const rpcRequestSchema = z.object({
  kind: z.literal("request"),
  id: z.string(),
  method: apiMethodSchema,
  params: z.unknown().optional(),
});

export type RpcRequest = z.infer<typeof rpcRequestSchema>;

// webview -> host: the webview no longer wants the answer to request `id`
// (its AbortSignal fired, e.g. the person pressed Cancel on a long load).
//   { kind: "cancel", id }
// The host drops the request and posts no reply for that id. It is best
// effort: the ApiService call itself isn't interrupted (it reads log files
// synchronously), so the work may finish; only its reply is forgotten. The
// webview rejects its own pending call at once and ignores any late reply.
// A cancel for an id the host has already answered, or never saw, is ignored.
export const rpcCancelSchema = z.object({
  kind: z.literal("cancel"),
  id: z.string(),
});

export type RpcCancel = z.infer<typeof rpcCancelSchema>;

// webview -> host: one of the web app's timing marks (vscode-extension.md
// §3.5 Performance), posted once per page as it's emitted.
//   { kind: "perfMark", name, timeMs }
// `timeMs` is the mark's time in ms since the page started
// (performance.mark's startTime). One-way: no id and no reply, so a mark
// never waits on, or delays, a request. The host validates it like
// everything else from the webview and silently drops anything malformed;
// it only records marks (step 10.9's integration tests read them), so the
// names are an allow-list and the time is bounded.
export const performanceMarkNameSchema = z.enum(["first-render", "data-ready"]);

export type PerformanceMarkName = z.infer<typeof performanceMarkNameSchema>;

// A day: far beyond any real mark, and small enough to stay meaningful.
export const MAX_PERFORMANCE_MARK_TIME_MS = 24 * 60 * 60 * 1000;

export const rpcPerformanceMarkSchema = z.object({
  kind: z.literal("perfMark"),
  name: performanceMarkNameSchema,
  timeMs: z.number().finite().nonnegative().max(MAX_PERFORMANCE_MARK_TIME_MS),
});

export type RpcPerformanceMark = z.infer<typeof rpcPerformanceMarkSchema>;

// host -> webview, one reply per request. `status` matches the HTTP API's,
// so the web code handles "unknown session" (404) the same on both transports.
export type RpcResponse =
  | { kind: "response"; id: string; ok: true; result: unknown }
  | { kind: "response"; id: string; ok: false; error: { status: 400 | 404 | 409 | 500; message: string } };

// host -> webview, unsolicited. selectSession: the sidebar picked a session
// (D10); configChanged: the Copilot logging settings changed -> refetch the
// config status.
export const hostEventNameSchema = z.enum(["configChanged", "themeChanged", "selectSession"]);

export type HostEventName = z.infer<typeof hostEventNameSchema>;

export type HostEvent = { kind: "event"; name: HostEventName; payload?: unknown };

// The selectSession event's payload (D10): the sidebar picked a session, and
// the web app handles it like a click in its own session list. `tab` is the
// Analyze mode right column's tab; `view` the center view ("Show tool audit"
// asks for "session-audit"); `adviceDialog` opens the advice-export dialog
// on this session ("Copy advice bundle"); `mode` is "learn" for a scenario
// the sidebar's Learn view picked (step 10.12), else Analyze. Only these
// values are accepted, so the webview ignores anything else the host could
// post.
export const selectSessionPayloadSchema = z.object({
  sessionId: z.string().min(1),
  mode: z.enum(["learn", "analyze"]).optional(),
  tab: z.enum(["explanation", "system-prompt", "tools"]).optional(),
  view: z.enum(["turns", "session-audit"]).optional(),
  adviceDialog: z.boolean().optional(),
});

export type SelectSessionPayload = z.infer<typeof selectSessionPayloadSchema>;

// webview -> host: a host command (vscode-extension.md G8) — something only
// the editor can do for the UI, behind the web app's HostCapabilities port.
// Deliberately not ApiService methods: they act on the editor, not on log
// data, and the standalone app has no host to send them to. The protocol is
// the request/response pair above with its own kind:
//   { kind: "command", id, command, args } -> { kind: "response", id, ok }
// Replies share the response shape, so the webview transport correlates
// both by id. The host validates them like requests — `command` against
// this allow-list, `args` with the command's schema — and answers anything
// else with 400; the webview is untrusted content. Which setting ids
// openSetting may open is the host's policy (it depends on the current
// config status), so it isn't encoded here.
export const hostCommandSchema = z.enum(["openSetting", "copyToClipboard", "openTextDocument"]);

export type HostCommand = z.infer<typeof hostCommandSchema>;

// Upper bound on clipboard text and document content, in UTF-16 code units
// (5 MiB of ASCII): far above any system prompt or advice bundle, well
// below what would stall the extension host.
export const MAX_HOST_COMMAND_TEXT_LENGTH = 5 * 1024 * 1024;

const boundedText = z.string().max(MAX_HOST_COMMAND_TEXT_LENGTH);

export const hostCommandArgsSchemas = {
  openSetting: z.object({ settingId: z.string().min(1) }),
  copyToClipboard: z.object({ text: boundedText }),
  openTextDocument: z.object({ content: boundedText, language: z.enum(["plaintext", "markdown", "json"]) }),
} as const satisfies Record<HostCommand, z.ZodType>;

export type HostCommandArgs = { [C in HostCommand]: z.infer<(typeof hostCommandArgsSchemas)[C]> };

export const rpcCommandSchema = z.object({
  kind: z.literal("command"),
  id: z.string(),
  command: hostCommandSchema,
  args: z.unknown().optional(),
});

export type RpcCommand = z.infer<typeof rpcCommandSchema>;

// host -> webview, one reply per command: done, or why not.
export type RpcCommandResponse =
  | { kind: "response"; id: string; ok: true }
  | { kind: "response"; id: string; ok: false; error: { status: 400 | 500; message: string } };
