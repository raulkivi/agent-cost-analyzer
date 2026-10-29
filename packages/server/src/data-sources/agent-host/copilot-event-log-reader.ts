import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { CopilotEvent, CopilotEventLog } from "./copilot-event.js";

export type { CopilotEvent, CopilotEventLog } from "./copilot-event.js";

// Real logs hold lines of 500 KB+; 8 MB leaves headroom while bounding what a
// corrupt or hostile line can cost to parse.
export const MAX_EVENT_LINE_CHARS = 8 * 1024 * 1024;

export interface ReadCopilotEventLogOptions {
  include?: (type: string) => boolean;
  maxLineChars?: number;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const stringOrNull = (v: unknown): string | null =>
  typeof v === "string" ? v : null;

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

export function parseCopilotEventLine(line: string): CopilotEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isPlainObject(raw)) return null;
  const { id, type } = raw;
  if (!isNonEmptyString(id) || !isNonEmptyString(type)) return null;

  let data: Record<string, unknown> = isPlainObject(raw.data) ? raw.data : {};
  if (type === "session.binary_asset" && "data" in data) {
    // The base64 payload can be megabytes and no builder needs it.
    const { data: _payload, ...rest } = data;
    data = rest;
  }
  return {
    id,
    type,
    parentId: stringOrNull(raw.parentId),
    timestamp: stringOrNull(raw.timestamp),
    agentId: stringOrNull(raw.agentId),
    data,
  };
}

const isMissingPath = (err: unknown): boolean => {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
};

// Streams line by line so a multi-MB log is never held as one string.
// Returns null when the file is absent; other I/O errors reject.
export async function readCopilotEventLog(
  filePath: string,
  options: ReadCopilotEventLogOptions = {},
): Promise<CopilotEventLog | null> {
  const maxLineChars = options.maxLineChars ?? MAX_EVENT_LINE_CHARS;
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  const events: CopilotEvent[] = [];
  let skippedLines = 0;

  // readline never rejects on a stream error; capture it ourselves.
  let streamError: unknown;
  const failed = new Promise<void>((resolve) => {
    stream.once("error", (err) => {
      streamError = err;
      resolve();
    });
  });

  try {
    const consume = (async () => {
      for await (const line of rl) {
        if (line.trim() === "") continue;
        if (line.length > maxLineChars) {
          skippedLines++;
          continue;
        }
        const event = parseCopilotEventLine(line);
        if (event === null) {
          skippedLines++;
          continue;
        }
        if (options.include && !options.include(event.type)) continue;
        events.push(event);
      }
    })();
    await Promise.race([consume, failed]);
    if (streamError !== undefined) throw streamError;
  } catch (err) {
    if (isMissingPath(err)) return null;
    throw err;
  } finally {
    rl.close();
    stream.destroy();
  }
  return { events, skippedLines };
}
