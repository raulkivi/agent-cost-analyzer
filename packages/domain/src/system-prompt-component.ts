// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";
import { tokenCountSchema } from "./token-count.js";

// Analyze mode only
export const systemPromptComponentSchema = z.object({
  kind: z.enum([
    "built-in",
    "repo-instructions",
    "path-scoped-instructions",
    "skill-manifest",
    "tool-definitions",
  ]),
  label: z.string(),
  tokenCount: tokenCountSchema,
});

export type SystemPromptComponent = z.infer<typeof systemPromptComponentSchema>;
