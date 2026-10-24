import { describe, expect, it } from "vitest";
import { isSseResponse, parseSseEvents } from "./sse.js";

describe("isSseResponse", () => {
  it("recognizes the text/event-stream mime type", () => {
    expect(isSseResponse({ responseMimeType: "text/event-stream", responseBody: "" })).toBe(true);
  });

  it("recognizes a body that starts with an SSE event/data line even without the mime type", () => {
    expect(
      isSseResponse({ responseMimeType: "application/json", responseBody: "event: message\ndata: {}\n" }),
    ).toBe(true);
    expect(isSseResponse({ responseMimeType: "application/json", responseBody: "  data: {}\n" })).toBe(true);
  });

  it("returns false for an ordinary JSON body", () => {
    expect(
      isSseResponse({ responseMimeType: "application/json", responseBody: '{"type":"message"}' }),
    ).toBe(false);
  });
});

describe("parseSseEvents", () => {
  it("parses a single event with an event name and one data line", () => {
    const events = parseSseEvents('event: message_start\ndata: {"type":"message_start"}\n\n');

    expect(events).toEqual([{ event: "message_start", data: '{"type":"message_start"}' }]);
  });

  it("joins multiple data lines within one event per the SSE spec", () => {
    const events = parseSseEvents("event: content\ndata: line one\ndata: line two\n\n");

    expect(events).toEqual([{ event: "content", data: "line one\nline two" }]);
  });

  it("splits multiple blank-line-delimited events", () => {
    const events = parseSseEvents(
      'event: message_start\ndata: {"a":1}\n\nevent: message_stop\ndata: {"b":2}\n\n',
    );

    expect(events).toEqual([
      { event: "message_start", data: '{"a":1}' },
      { event: "message_stop", data: '{"b":2}' },
    ]);
  });

  it("returns an event with no event name when only data: is present", () => {
    const events = parseSseEvents('data: {"delta":1}\n\n');

    expect(events).toEqual([{ event: undefined, data: '{"delta":1}' }]);
  });

  it("drops a block with no data: line, e.g. a bare comment/ping", () => {
    const events = parseSseEvents(': ping\n\ndata: {"ok":true}\n\n');

    expect(events).toEqual([{ event: undefined, data: '{"ok":true}' }]);
  });

  it("handles CRLF line endings", () => {
    const events = parseSseEvents('event: message_start\r\ndata: {"a":1}\r\n\r\n');

    expect(events).toEqual([{ event: "message_start", data: '{"a":1}' }]);
  });

  it("returns an empty array for an empty body", () => {
    expect(parseSseEvents("")).toEqual([]);
  });
});
