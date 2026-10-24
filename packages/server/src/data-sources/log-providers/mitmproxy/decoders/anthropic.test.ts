import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readHarFile, harEntryToRawExchange } from "../har.js";
import { anthropicDecoder } from "./anthropic.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../fixtures/mitmproxy",
);

function loadExchange(fixtureFile: string) {
  const har = readHarFile(path.join(fixturesDir, fixtureFile));
  return harEntryToRawExchange(har.log.entries[0]);
}

describe("anthropicDecoder", () => {
  it("recognizes an Anthropic exchange via the anthropic-version request header", () => {
    const exchange = loadExchange("anthropic-non-streamed.har");

    expect(anthropicDecoder.recognizes(exchange)).toBe(true);
  });

  it("does not recognize an unrelated vendor's exchange", () => {
    const exchange = loadExchange("unknown-vendor.har");

    expect(anthropicDecoder.recognizes(exchange)).toBe(false);
  });

  it("decodes a non-streamed response's usage object directly", () => {
    const exchange = loadExchange("anthropic-non-streamed.har");

    const result = anthropicDecoder.decode(exchange);

    expect(result.usage.uncachedInput).toEqual({ known: true, value: 120 });
    expect(result.usage.cacheWrite).toEqual({ known: true, value: 10 });
    expect(result.usage.cacheRead).toEqual({ known: true, value: 5 });
    expect(result.usage.output).toEqual({ known: true, value: 42 });
    expect(result.usage.model).toBe("claude-3-5-haiku-20241022");
    expect(result.usage.tool.known).toBe(false);
    expect(result.usage.reasoning.known).toBe(false);
    expect(result.usage.costAiCredits.known).toBe(false);
    expect(result.toolCalls).toEqual([]);
  });

  it("reassembles usage from message_start + message_delta SSE events", () => {
    const exchange = loadExchange("anthropic-streamed.har");

    const result = anthropicDecoder.decode(exchange);

    expect(result.usage.uncachedInput).toEqual({ known: true, value: 120 });
    expect(result.usage.cacheWrite).toEqual({ known: true, value: 10 });
    expect(result.usage.cacheRead).toEqual({ known: true, value: 5 });
    // message_delta's usage.output_tokens (42) supersedes message_start's
    // placeholder output_tokens (1) — the final cumulative total.
    expect(result.usage.output).toEqual({ known: true, value: 42 });
    expect(result.usage.model).toBe("claude-3-5-haiku-20241022");
  });

  it("degrades to unavailable, not a throw, on an unparseable SSE data payload", () => {
    const exchange = loadExchange("malformed-sse.har");

    const result = anthropicDecoder.decode(exchange);

    expect(result.usage.uncachedInput.known).toBe(false);
    expect(result.usage.output.known).toBe(false);
    expect(result.toolCalls).toEqual([]);
  });
});
