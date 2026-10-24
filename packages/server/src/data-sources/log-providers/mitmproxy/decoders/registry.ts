import type { MitmExchangeDecoder, NormalizedExchange, RawMitmExchange } from "./decoder.js";
import { unavailableUsage } from "../normalized-usage.js";

export const UNRECOGNIZED_VENDOR_REASON =
  "No registered decoder recognized this exchange's request/response shape (unrecognized vendor).";

function decoderFailureReason(vendorId: string): string {
  return `The ${vendorId} decoder recognized this exchange but failed to decode it.`;
}

// The decoder-registry seam (architecture.md §6.2.1/§6.2.3): the first
// decoder that recognizes the exchange decodes it; an exchange no decoder
// recognizes — or one whose recognized decoder throws while decoding —
// degrades to explicitly unavailable usage rather than guessing or failing
// the whole session (constraint 6).
export function decodeExchange(
  exchange: RawMitmExchange,
  decoders: MitmExchangeDecoder[],
): NormalizedExchange {
  const decoder = decoders.find((candidate) => candidate.recognizes(exchange));
  if (!decoder) {
    return { usage: unavailableUsage(UNRECOGNIZED_VENDOR_REASON), toolCalls: [] };
  }

  try {
    return decoder.decode(exchange);
  } catch {
    return { usage: unavailableUsage(decoderFailureReason(decoder.vendorId)), toolCalls: [] };
  }
}
