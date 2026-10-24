import { z } from "zod";
import { configWarningSchema } from "./config-warning.js";

export const configStatusSchema = z.object({
  checkedAt: z.string(),
  vscodeUserSettingsPath: z.string().nullable(),
  loggingEnabled: z.boolean(),
  maxRetainedSessionLogs: z.number().nullable(),
  minRetainedSessionLogsThreshold: z.number(),
  warnings: z.array(configWarningSchema),
});

export type ConfigStatus = z.infer<typeof configStatusSchema>;
