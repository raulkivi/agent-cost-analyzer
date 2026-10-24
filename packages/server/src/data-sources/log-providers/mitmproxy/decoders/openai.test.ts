import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readHarFile, harEntryToRawExchange } from "../har.js";
import { openAiDecoder } from "./openai.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../fixtures/mitmproxy",
);

function loadExchange(fixtureFile: string) {
  const har = readHarFile(path.join(fixturesDir, fixtureFile));
  return harEntryToRawExchange(har.log.entries[0]);
}

describe("openAiDecoder", () => {
  it("recognizes an OpenAI exchange via the openai-organization request header", () => {
    const exchange = loadExchange("openai-streamed-with-usage.har");

    expect(openAiDecoder.recognizes(exchange)).toBe(true);
  });

  it("does not recognize an Anthropic exchange", () => {
    const exchange = loadExchange("anthropic-non-streamed.har");

    expect(openAiDecoder.recognizes(exchange)).toBe(false);
  });

  it("does not recognize an unrelated vendor's exchange", () => {
    const exchange = loadExchange("unknown-vendor.har");

    expect(openAiDecoder.recognizes(exchange)).toBe(false);
  });

  it("decodes usage from the final chunk when stream_options.include_usage was set", () => {
    const exchange = loadExchange("openai-streamed-with-usage.har");

    const result = openAiDecoder.decode(exchange);

    expect(result.usage.uncachedInput).toEqual({ known: true, value: 30 });
    expect(result.usage.cacheRead).toEqual({ known: true, value: 20 });
    expect(result.usage.output).toEqual({ known: true, value: 10 });
    expect(result.usage.reasoning).toEqual({ known: true, value: 0 });
    expect(result.usage.model).toBe("gpt-4o-mini");
    expect(result.usage.cacheWrite.known).toBe(false);
    expect(result.usage.costAiCredits.known).toBe(false);
  });

  it("marks usage unavailable with the actionable reason when stream_options.include_usage was not set", () => {
    const exchange = loadExchange("openai-streamed-without-usage.har");

    const result = openAiDecoder.decode(exchange);

    expect(result.usage.uncachedInput).toEqual({
      known: false,
      reason: "OpenAI stream did not request usage (stream_options.include_usage was not set).",
    });
    expect(result.usage.model).toBe("gpt-4o-mini");
  });
});
