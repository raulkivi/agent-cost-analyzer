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
  // the host lists the sessions in its own sidebar, so the Analyze mode
  // view gives that column to the turns (step 10.11)
  sessionSidebar: z.boolean(),
  // Learn scenarios replayed on a chosen vendor and model (Phase 13): the
  // extension has it from 13.6; the standalone app gets it in 13.10.
  vendorSimulation: z.boolean(),
  // The Dashboard's Cost over time and Compare tabs (Phase 15 step 15.9),
  // over GET /api/cost/*: the standalone app has them; the extension gets
  // its own in step 15.14, so until then the tabs are hidden there.
  costAnalysis: z.boolean(),
});

export type ProductFeatures = z.infer<typeof productFeaturesSchema>;

export const productProfileSchema = z.object({
  productId: z.enum(["vscode-extension", "standalone"]),
  displayName: z.string(),
  version: z.string(),
  features: productFeaturesSchema,
});

export type ProductProfile = z.infer<typeof productProfileSchema>;
