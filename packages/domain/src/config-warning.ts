import { z } from "zod";

export const configWarningSchema = z.object({
  code: z.enum([
    "logging-disabled",
    "retention-too-low",
    "settings-not-found",
    "agent-traces-unavailable",
  ]),
  // required: the app can't produce any usage numbers without it fixed.
  // optional: an additive enrichment (Phase 8.5's cache-write/reasoning
  // tokens) — the app works fully without it. Not defaulted, so every
  // builder must state its severity explicitly rather than it being implied.
  severity: z.enum(["required", "optional"]),
  settingId: z.string(),
  currentValue: z.unknown(),
  recommendedValue: z.unknown(),
  message: z.string(),
  helpSteps: z.array(z.string()),
});

export type ConfigWarning = z.infer<typeof configWarningSchema>;
