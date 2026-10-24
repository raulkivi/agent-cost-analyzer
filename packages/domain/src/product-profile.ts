import { z } from "zod";

// Which product the shared UI is running in (vscode-extension.md §3.3) —
// the standalone app or the VS Code extension. The UI renders from these
// flags, never from an "am I the extension?" check, so each component only
// sees the flags it needs (ISP).
export const productFeaturesSchema = z.object({
  // false when exactly one provider is registered
  providerSelect: z.boolean(),
  // drives the dashboard's "across every provider" wording and provider facet
  crossProviderInsights: z.boolean(),
  // "Fix" buttons on config warnings
  settingFixes: z.boolean(),
  // system prompt -> editor document
  openInEditor: z.boolean(),
});

export type ProductFeatures = z.infer<typeof productFeaturesSchema>;

export const productProfileSchema = z.object({
  productId: z.enum(["vscode-extension", "standalone"]),
  displayName: z.string(),
  version: z.string(),
  features: productFeaturesSchema,
});

export type ProductProfile = z.infer<typeof productProfileSchema>;
