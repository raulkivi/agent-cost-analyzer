import { z } from "zod";
import {
  confidenceMatchesSources,
  confidenceMessage,
  confidenceSchema,
  layerSchema,
} from "./vendor-profile.js";

export const cacheOutcomeSchema = z.enum(["hit", "partial", "miss", "unknown"]);

export const turnSimulationSchema = z
  .object({
    vendorId: z.string(),
    modelId: z.string(),
    cacheOutcome: cacheOutcomeSchema,
    invalidatedFrom: layerSchema.optional(),
    note: z.string(),
    confidence: confidenceSchema,
    sourceIds: z.array(z.string()),
  })
  .refine(confidenceMatchesSources, {
    message: confidenceMessage,
    path: ["sourceIds"],
  });

export type CacheOutcome = z.infer<typeof cacheOutcomeSchema>;
export type TurnSimulation = z.infer<typeof turnSimulationSchema>;
