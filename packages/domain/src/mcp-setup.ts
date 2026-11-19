// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { z } from "zod";

export const mcpSetupClientIdSchema = z.enum([
  "claude-code",
  "claude-desktop",
  "cursor",
  "vscode",
  "vscode-insiders",
  "codex",
  "gemini",
]);

export type McpSetupClientId = z.infer<typeof mcpSetupClientIdSchema>;

// What to do by hand: a one-line command, or a whole config file to merge.
export const mcpSetupManualSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("command"), command: z.string() }),
  // `path` is for display only: the home folder is shown as `~`.
  z.object({ kind: z.literal("json"), path: z.string(), json: z.string() }),
]);

export type McpSetupManual = z.infer<typeof mcpSetupManualSchema>;

export const mcpSetupClientSchema = z.object({
  id: mcpSetupClientIdSchema,
  label: z.string(),
  installCommand: z.string(),
  manual: mcpSetupManualSchema,
  installLink: z.string().optional(),
});

export type McpSetupClient = z.infer<typeof mcpSetupClientSchema>;

export const mcpSetupResponseSchema = z.object({
  version: z.string(),
  clients: z.array(mcpSetupClientSchema),
});

export type McpSetupResponse = z.infer<typeof mcpSetupResponseSchema>;
