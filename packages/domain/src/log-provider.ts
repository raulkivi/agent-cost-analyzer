import { z } from "zod";

// Log-provider selection is a separate app-level contract from Session
// itself (architecture.md §5) — the API/UI only ever see these generic
// shapes, never a provider's internal configuration or vendor detail.
export const logProviderDescriptorSchema = z.object({
  id: z.string(),
  label: z.string(),
  available: z.boolean(),
  unavailableReason: z.string().optional(),
});

export type LogProviderDescriptor = z.infer<typeof logProviderDescriptorSchema>;

export const logProviderStatusSchema = z.object({
  providers: z.array(logProviderDescriptorSchema),
  activeProviderId: z.string(),
});

export type LogProviderStatus = z.infer<typeof logProviderStatusSchema>;
