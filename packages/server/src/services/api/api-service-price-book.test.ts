import { describe, expect, it } from "vitest";
import type { PriceBookListing } from "@agent-cost-analyzer/domain";
import type { PriceBookQuery } from "../pricing/price-book.js";
import { ApiService, PRICE_BOOK_UNAVAILABLE_MESSAGE, type ApiServiceDeps } from "./api-service.js";
import { BadRequestError, NotFoundError } from "./api-errors.js";

// Phase 15 step 15.5: getPriceBook validates its query and reads the
// PriceBookReader it was given; a product without one answers 404.
const empty: PriceBookListing = { channels: [], versions: [], sources: [], gaps: [], unknown: [], problems: [] };

function service(priceBook?: ApiServiceDeps["priceBook"]): ApiService {
  // getPriceBook reads only the price book.
  return new ApiService({ ...(priceBook ? { priceBook } : {}) } as ApiServiceDeps);
}

describe("ApiService.getPriceBook", () => {
  it("passes the parsed channel, model and at to the price book", async () => {
    const queries: PriceBookQuery[] = [];
    const api = service({ list: (query) => (queries.push(query), empty) });

    await expect(api.getPriceBook({ channel: "github-copilot", model: "m", at: "2026-11-05" })).resolves.toEqual(empty);
    expect(queries).toEqual([{ channel: "github-copilot", model: "m", at: "2026-11-05" }]);
  });

  it("rejects a malformed query as a bad request", async () => {
    const api = service({ list: () => empty });

    await expect(api.getPriceBook({ at: "soon" })).rejects.toBeInstanceOf(BadRequestError);
    await expect(api.getPriceBook({ channel: ["a", "b"] })).rejects.toBeInstanceOf(BadRequestError);
  });

  it("is not found in a product without a price book (the extension, for now)", async () => {
    await expect(service().getPriceBook({})).rejects.toEqual(new NotFoundError(PRICE_BOOK_UNAVAILABLE_MESSAGE));
  });
});
