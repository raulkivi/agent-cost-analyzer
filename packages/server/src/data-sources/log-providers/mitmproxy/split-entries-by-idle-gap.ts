import type { HarEntry } from "./har.js";

// A capture file grouped by wall-clock proximity of consecutive entries'
// startedDateTime (start-to-start — HarEntry carries no duration field, and
// real mitmproxy hardump output doesn't reliably populate HAR's optional
// `time`/`timings` fields either, so start-to-start is the only signal
// available). 30 minutes comfortably exceeds the ~5-minute in-session
// pauses this app's own Learn-mode cache-TTL scenarios treat as normal,
// while still separating genuinely distinct, manually-started captures.
export const DEFAULT_IDLE_GAP_THRESHOLD_MS = 30 * 60 * 1000;

// A gap strictly greater than thresholdMs starts a new segment; a gap
// equal to the threshold does not (boundary is exclusive). A negative or
// zero gap (out-of-order/duplicate timestamps, e.g. clock skew) never
// splits, since it can never exceed a positive threshold. A file with zero
// entries yields one empty segment, not zero segments, so a
// present-but-empty .har file still surfaces as a (zero-turn) session
// rather than silently vanishing from the list.
export function splitEntriesByIdleGap(entries: HarEntry[], thresholdMs: number): HarEntry[][] {
  if (entries.length === 0) {
    return [[]];
  }

  const segments: HarEntry[][] = [[entries[0]]];
  for (let i = 1; i < entries.length; i++) {
    const gapMs = Date.parse(entries[i].startedDateTime) - Date.parse(entries[i - 1].startedDateTime);
    if (gapMs > thresholdMs) {
      segments.push([]);
    }
    segments[segments.length - 1].push(entries[i]);
  }
  return segments;
}
