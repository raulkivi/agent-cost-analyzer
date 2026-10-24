import type { SystemPromptRecord } from "../domain/SystemPromptRecord.js";

/**
 * Destination for captured system-prompt records.
 * One method, one responsibility: persist a record somewhere durable.
 */
export interface SystemPromptSink {
  write(record: SystemPromptRecord): Promise<void>;
}
