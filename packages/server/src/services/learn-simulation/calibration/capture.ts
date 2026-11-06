import { z } from "zod";
import { harnessSchema } from "@agent-cost-analyzer/domain";

const tokens = z.number().int().nonnegative();

// One real LLM request, reduced to numbers (step 13.5a). No prompt, response
// or tool text is ever stored: only sizes, gaps and what the provider billed.
export const captureRequestSchema = z.object({
  index: z.number().int().nonnegative(),
  // Minutes since the previous request in the capture (0 for the first).
  gapMinutes: z.number().nonnegative(),
  recorded: z.object({
    uncachedInput: tokens,
    cacheRead: tokens,
    cacheWrite: tokens,
    // Cache writes the provider says used the 1-hour lifetime, when it says.
    extendedCacheWrite: tokens.optional(),
    output: tokens,
  }),
});

export const calibrationCaptureSchema = z.object({
  id: z.string(),
  source: z.enum(["claude-code", "copilot-agent-host", "copilot-local"]),
  harness: harnessSchema,
  vendorId: z.literal("anthropic"),
  // Price-table model id the simulator replays on.
  modelId: z.string(),
  // What the person who made the capture knows about it, without content.
  notes: z.string().optional(),
  requests: z.array(captureRequestSchema).min(2),
});

export type CaptureRequest = z.infer<typeof captureRequestSchema>;
export type CalibrationCapture = z.infer<typeof calibrationCaptureSchema>;

export function requestInputTokens(request: CaptureRequest): number {
  const { uncachedInput, cacheRead, cacheWrite, extendedCacheWrite } =
    request.recorded;
  return uncachedInput + cacheRead + cacheWrite + (extendedCacheWrite ?? 0);
}
