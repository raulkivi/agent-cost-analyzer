import { describe, expect, it } from "vitest";
import { decodeExchange, UNRECOGNIZED_VENDOR_REASON } from "./registry.js";
import type { MitmExchangeDecoder, RawMitmExchange } from "./decoder.js";
import { unavailableUsage } from "../normalized-usage.js";

const EXCHANGE: RawMitmExchange = {
  requestHeaders: {},
  requestBody: "{}",
  responseHeaders: {},
  responseBody: "{}",
  responseMimeType: "application/json",
  timestamp: "2026-08-01T12:00:00.000Z",
};

describe("decodeExchange", () => {
  it("marks an exchange unavailable with an unrecognized-vendor reason when no decoder is registered", () => {
    const result = decodeExchange(EXCHANGE, []);

    expect(result.usage.uncachedInput).toEqual({ known: false, reason: UNRECOGNIZED_VENDOR_REASON });
    expect(result.toolCalls).toEqual([]);
  });

  it("marks an exchange unavailable when no registered decoder recognizes it", () => {
    const decoder: MitmExchangeDecoder = {
      vendorId: "anthropic",
      recognizes: () => false,
      decode: () => ({ usage: unavailableUsage("unreachable"), toolCalls: [] }),
    };

    const result = decodeExchange(EXCHANGE, [decoder]);

    expect(result.usage.uncachedInput).toEqual({ known: false, reason: UNRECOGNIZED_VENDOR_REASON });
  });

  it("delegates to the first decoder that recognizes the exchange", () => {
    const decoder: MitmExchangeDecoder = {
      vendorId: "openai",
      recognizes: () => true,
      decode: () => ({
        usage: { ...unavailableUsage("n/a"), uncachedInput: { known: true, value: 42 } },
        toolCalls: [],
      }),
    };

    const result = decodeExchange(EXCHANGE, [decoder]);

    expect(result.usage.uncachedInput).toEqual({ known: true, value: 42 });
  });

  it("degrades to unavailable, rather than throwing, when a recognized decoder's decode() throws", () => {
    const decoder: MitmExchangeDecoder = {
      vendorId: "anthropic",
      recognizes: () => true,
      decode: () => {
        throw new Error("boom");
      },
    };

    const result = decodeExchange(EXCHANGE, [decoder]);

    expect(result.usage.uncachedInput.known).toBe(false);
    expect(result.toolCalls).toEqual([]);
  });
});
