import { z } from "zod";
import { toolCallRecordSchema } from "./tool-call-record.js";
import { harnessSchema } from "./vendor-profile.js";

const tokens = z.number().int().nonnegative();
const stepIndex = z.number().int().nonnegative();

export const scriptEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("model-switch"),
    toRole: z.enum(["primary", "cheaper"]),
  }),
  z.object({ type: z.literal("tools-changed"), deltaTokens: z.number().int() }),
  z.object({
    type: z.literal("system-changed"),
    deltaTokens: z.number().int(),
    cause: z.enum(["edit", "applyTo"]),
  }),
  z.object({ type: z.literal("image-added") }),
  z.object({ type: z.literal("image-removed") }),
  z.object({ type: z.literal("thinking-changed"), enabled: z.boolean() }),
  z.object({ type: z.literal("compaction"), summaryTokens: tokens }),
  z.object({ type: z.literal("clear") }),
  z.object({ type: z.literal("rewind"), toStep: stepIndex }),
  z.object({
    type: z.literal("fork"),
    branch: z.string(),
    fromStep: stepIndex,
  }),
  z.object({ type: z.literal("extended-ttl") }),
]);

// Pixel sizes, not tokens: each vendor profile converts with its own formula.
export const scriptImageSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const scriptStepSchema = z.object({
  index: stepIndex,
  userMessage: z.string(),
  assistantResponse: z.string(),
  toolCalls: z.array(toolCallRecordSchema),
  explanation: z.string(),
  idleMinutesBefore: z.number().nonnegative().optional(),
  newContent: z.object({
    userTokens: tokens,
    toolResultTokens: tokens,
    reasoningTokens: tokens,
    outputTokens: tokens,
    images: z.array(scriptImageSchema).optional(),
  }),
  events: z.array(scriptEventSchema),
});

export const harnessTextSchema = z.object({
  title: z.string().optional(),
  userMessages: z.array(z.string()).optional(),
  explanations: z.array(z.string()).optional(),
});

export const scenarioScriptSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  harnesses: z.array(harnessSchema).min(1),
  textByHarness: z.partialRecord(harnessSchema, harnessTextSchema).optional(),
  sessionKind: z.enum(["main", "subagent"]),
  parentScenarioId: z.string().optional(),
  staticPrefix: z.object({ toolsTokens: tokens, systemTokens: tokens }),
  steps: z.array(scriptStepSchema),
});

export type ScriptEvent = z.infer<typeof scriptEventSchema>;
export type ScriptImage = z.infer<typeof scriptImageSchema>;
export type ScriptStep = z.infer<typeof scriptStepSchema>;
export type HarnessText = z.infer<typeof harnessTextSchema>;
export type ScenarioScript = z.infer<typeof scenarioScriptSchema>;
