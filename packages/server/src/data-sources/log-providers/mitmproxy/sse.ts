// Minimal SSE (Server-Sent Events) parsing over an already-fully-buffered
// response body (HAR's response.content.text — mitmproxy already
// reassembled the wire transfer, so this never touches a live stream).
export interface SseEvent {
  event?: string;
  data: string;
}

export function isSseResponse(exchange: { responseMimeType: string; responseBody: string }): boolean {
  return (
    exchange.responseMimeType === "text/event-stream" ||
    /^\s*(event:|data:)/.test(exchange.responseBody)
  );
}

// Splits on blank-line-delimited SSE events, joining multiple `data:` lines
// within one event per the SSE spec. An event with no `data:` line at all
// (e.g. a bare comment/ping) is dropped, not returned as an empty entry.
export function parseSseEvents(body: string): SseEvent[] {
  const events: SseEvent[] = [];
  const blocks = body.split(/\r?\n\r?\n/);

  for (const block of blocks) {
    if (!block.trim()) {
      continue;
    }
    let eventName: string | undefined;
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }
    if (dataLines.length > 0) {
      events.push({ event: eventName, data: dataLines.join("\n") });
    }
  }

  return events;
}
