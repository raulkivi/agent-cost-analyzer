import { anthropicDecoder } from "./anthropic.js";
import { openAiDecoder } from "./openai.js";
import type { MitmExchangeDecoder } from "./decoder.js";

// The registered vendor decoders (architecture.md §6.2.1: "initial decoders
// cover Anthropic and OpenAI SDK traffic"). Adding a third vendor is adding
// its decoder module and one entry here — no other file changes.
export const defaultMitmExchangeDecoders: MitmExchangeDecoder[] = [anthropicDecoder, openAiDecoder];
