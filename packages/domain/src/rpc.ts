import { z } from "zod";

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
  "getLogProviderStatus",
  "setActiveLogProvider",
  "getSessionAudit",
  "listToolCalls",
  "getAuditRollup",
  "getInsights",
  "getHealth",
  "getProductProfile",
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

export const apiMethodParamsSchemas = {
  listSessions: noParams,
  getSession: idParams,
  getTurnDetail: z.object({ sessionId: sessionIdSchema, turnIndex: z.unknown().optional() }),
  getSystemPromptText: idParams,
  getConfigStatus: noParams,
  setRetentionThreshold: z.object({ value: z.unknown().optional() }),
  listLearnScenarios: noParams,
  getLearnScenario: idParams,
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
} as const satisfies Record<ApiMethod, z.ZodType>;

// webview -> host (vscode-extension.md §4). `params` stays unknown here: the
// host validates it per method with apiMethodParamsSchemas.
export const rpcRequestSchema = z.object({
  kind: z.literal("request"),
  id: z.string(),
  method: apiMethodSchema,
  params: z.unknown().optional(),
});

export type RpcRequest = z.infer<typeof rpcRequestSchema>;

// host -> webview, one reply per request. `status` matches the HTTP API's,
// so the web code handles "unknown session" (404) the same on both transports.
export type RpcResponse =
  | { kind: "response"; id: string; ok: true; result: unknown }
  | { kind: "response"; id: string; ok: false; error: { status: 400 | 404 | 500; message: string } };

// host -> webview, unsolicited. selectSession: the sidebar picked a session
// (D10); configChanged: the Copilot logging settings changed -> refetch the
// config status.
export const hostEventNameSchema = z.enum(["configChanged", "themeChanged", "selectSession"]);

export type HostEventName = z.infer<typeof hostEventNameSchema>;

export type HostEvent = { kind: "event"; name: HostEventName; payload?: unknown };
