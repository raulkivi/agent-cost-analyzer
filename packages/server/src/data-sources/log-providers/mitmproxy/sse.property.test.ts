import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseSseEvents, type SseEvent } from "./sse.js";

// Values the parser trims and line-splits, so only trimmed, single-line text
// can survive a round trip unchanged.
const value = fc
  .string({ unit: "grapheme-ascii", maxLength: 20 })
  .filter((s) => !/[\r\n]/.test(s) && s === s.trim());

const sseEvent: fc.Arbitrary<SseEvent> = fc.record({
  event: fc.option(value, { nil: undefined }),
  data: fc.array(value, { minLength: 1, maxLength: 4 }).map((lines) => lines.join("\n")),
});

function serialize(events: SseEvent[], eol: string): string {
  return events
    .map((e) => [
      ...(e.event === undefined ? [] : [`event: ${e.event}`]),
      ...e.data.split("\n").map((line) => `data: ${line}`),
    ].join(eol))
    .join(eol + eol);
}

describe("parseSseEvents properties", () => {
  it("parses serialised events back to the same list for LF and CRLF", () => {
    fc.assert(
      fc.property(fc.array(sseEvent, { maxLength: 6 }), fc.boolean(), (events, crlf) => {
        const body = serialize(events, crlf ? "\r\n" : "\n");
        expect(parseSseEvents(body)).toEqual(events.map((e) => ({ event: e.event, data: e.data })));
      }),
    );
  });

  it("never throws on arbitrary input and always returns string data", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.string({ unit: "binary" }), fc.string({ unit: "grapheme" })),
        (body) => {
          const events = parseSseEvents(body);
          for (const e of events) {
            expect(typeof e.data).toBe("string");
          }
        },
      ),
    );
  });
});
