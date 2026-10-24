import { readFileSync } from "node:fs";
import { redactHeaders } from "./redact-headers.js";
import type { RawMitmExchange } from "./decoders/decoder.js";

export interface HarHeader {
  name: string;
  value: string;
}

export interface HarRequest {
  method: string;
  url: string;
  headers: HarHeader[];
  postData?: { mimeType?: string; text?: string };
}

export interface HarResponse {
  status: number;
  headers: HarHeader[];
  content: { mimeType?: string; text?: string; encoding?: string };
}

export interface HarEntry {
  startedDateTime: string;
  request: HarRequest;
  response: HarResponse;
}

export interface HarFile {
  log: { entries: HarEntry[] };
}

// Defensive per architecture.md §7's parsing posture, applied to HAR
// instead of main.jsonl: a file that isn't shaped like a HAR (missing
// log.entries[]) is a clear error, not something to silently coerce.
export function readHarFile(filePath: string): HarFile {
  const raw: unknown = JSON.parse(readFileSync(filePath, "utf-8"));
  const entries = (raw as { log?: { entries?: unknown } } | null)?.log?.entries;
  if (!Array.isArray(entries)) {
    throw new Error(`"${filePath}" is not a valid HAR file (missing log.entries[]).`);
  }
  return raw as HarFile;
}

function headersToRecord(headers: HarHeader[] | undefined): Record<string, string> {
  const record: Record<string, string> = {};
  for (const header of headers ?? []) {
    record[header.name] = header.value;
  }
  return record;
}

// Header redaction (§4) happens here, at the single seam every entry passes
// through on its way from the raw HAR file to a decoder — no decoder can
// accidentally forward a credential by omission.
export function harEntryToRawExchange(entry: HarEntry): RawMitmExchange {
  return {
    requestHeaders: redactHeaders(headersToRecord(entry.request?.headers)),
    requestBody: entry.request?.postData?.text ?? "",
    responseHeaders: redactHeaders(headersToRecord(entry.response?.headers)),
    responseBody: entry.response?.content?.text ?? "",
    responseMimeType: entry.response?.content?.mimeType ?? "",
    timestamp: entry.startedDateTime,
  };
}
