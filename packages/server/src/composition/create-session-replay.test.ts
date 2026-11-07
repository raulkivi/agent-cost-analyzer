import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sessionReplaySchema } from "@agent-cost-analyzer/domain";
import { ClaudeCodeLogProvider } from "../data-sources/claude-code/claude-code-log-provider.js";
import { computeClaudeCodeFileHash } from "../data-sources/claude-code/session-id.js";
import { loadVendorProfiles } from "../data-sources/vendor-profiles/loader.js";
import { BundledPriceBookSource } from "../services/pricing/bundled-price-book-source.js";
import { PriceBook } from "../services/pricing/price-book.js";
import { createSessionReplay } from "./create-session-replay.js";
import { createTurnPricer } from "./create-turn-pricer.js";

// Phase 14 step 14.5: one wiring of SessionReplayService for every product
// (the standalone app, its MCP server, the extension and its MCP server).
const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../../fixtures");
const projectsDir = path.join(fixtures, "claude-code");
const sessionFile = path.join(projectsDir, "-home-dev-project", "normal-session.jsonl");

describe("createSessionReplay", () => {
  it("replays a real provider's session on another model through the price book", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: projectsDir });
    const priceBook = new PriceBook(new BundledPriceBookSource());
    const service = createSessionReplay({
      providers: { getActiveProvider: () => provider, getProvider: () => provider },
      profiles: loadVendorProfiles(path.join(fixtures, "vendor-profiles")),
      priceBook,
      pricer: createTurnPricer(priceBook),
    });

    const result = await service.replay({ sessionId: computeClaudeCodeFileHash(sessionFile), model: "claude-haiku-5.5" });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(sessionReplaySchema.safeParse(result.value).success).toBe(true);
    expect(result.value).toMatchObject({ simulated: true, model: "claude-haiku-5.5", vendorId: "anthropic" });
  });

  it("refuses a model no vendor profile lists", async () => {
    const provider = new ClaudeCodeLogProvider({ projectsDirPath: projectsDir });
    const priceBook = new PriceBook(new BundledPriceBookSource());
    const service = createSessionReplay({
      providers: { getActiveProvider: () => provider, getProvider: () => provider },
      profiles: loadVendorProfiles(path.join(fixtures, "vendor-profiles")),
      priceBook,
      pricer: createTurnPricer(priceBook),
    });

    const result = await service.replay({ sessionId: computeClaudeCodeFileHash(sessionFile), model: "not-a-model" });

    expect(result.status).toBe("unknown-model");
  });
});
