// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { priceBookListingSchema, type PriceBookEntry, type Source } from "@agent-cost-analyzer/domain";
import { PriceBook } from "./price-book.js";
import type { PriceBookData, PriceBookSource } from "./price-book-source.js";

const tier = { inputUsdPerM: 3, cachedInputUsdPerM: 0.3, cacheWriteUsdPerM: 3.75, outputUsdPerM: 15 };
const source: Source = { id: "doc", title: "Doc", url: "https://example.com", checkedAt: "2026-11-05" };

function entry(overrides: Partial<PriceBookEntry> = {}): PriceBookEntry {
  const effectiveFrom = overrides.effectiveFrom ?? "2026-01-01";
  return {
    id: `${overrides.channel ?? "github-copilot"}:${overrides.modelId ?? "sonnet"}:${effectiveFrom}`,
    channel: "github-copilot",
    modelId: "sonnet",
    currency: "USD",
    effectiveFrom,
    tiers: [tier],
    kind: "list",
    sourceIds: ["doc"],
    origin: "bundled",
    ...overrides,
  };
}

function book(versions: PriceBookEntry[], extra: Partial<PriceBookData> = {}): PriceBook {
  const data: PriceBookData = { versions, sources: [source], problems: [], ...extra };
  const fake: PriceBookSource = { load: () => data };
  return new PriceBook(fake);
}

// Two list versions meeting at 2026-09-01, then a gap until 2026-10-01.
const january = entry({ effectiveFrom: "2026-01-01", effectiveTo: "2026-09-01" });
const september = entry({ effectiveFrom: "2026-09-01", effectiveTo: "2026-09-15", tiers: [{ ...tier, inputUsdPerM: 2 }] });
const october = entry({ effectiveFrom: "2026-10-01", tiers: [{ ...tier, inputUsdPerM: 1 }] });

describe("PriceBook.snapshot (step 15.6)", () => {
  it("reads its source once, so pricing a whole dataset doesn't re-read the projects file per turn", () => {
    let loads = 0;
    const data: PriceBookData = { versions: [october], sources: [source], problems: [] };
    const snapshot = new PriceBook({ load: () => ((loads += 1), data) }).snapshot();
    snapshot.priceFor("github-copilot", "sonnet", "2026-10-02");
    snapshot.modelIds("github-copilot");
    snapshot.newestVersion("github-copilot", "sonnet");
    expect(loads).toBe(1);
    expect(snapshot.priceFor("github-copilot", "sonnet", "2026-10-02")).toEqual({ known: true, version: october });
  });
});

describe("PriceBook.modelIds (step 15.6)", () => {
  it("lists the model ids a channel prices, once each, sorted", () => {
    const two = book([october, january, entry({ modelId: "haiku" }), entry({ channel: "openai-api", modelId: "gpt" })]);
    expect(two.modelIds("github-copilot")).toEqual(["haiku", "sonnet"]);
    expect(two.modelIds("xai-api")).toEqual([]);
  });
});

describe("PriceBook.priceFor", () => {
  const history = book([october, january, september]);

  it("returns the version whose [effectiveFrom, effectiveTo) contains the time", () => {
    expect(history.priceFor("github-copilot", "sonnet", "2026-05-05T12:00:00Z")).toEqual({ known: true, version: january });
  });

  it("includes effectiveFrom and excludes effectiveTo", () => {
    expect(history.priceFor("github-copilot", "sonnet", "2026-01-01T00:00:00.000Z")).toMatchObject({ version: { id: january.id } });
    expect(history.priceFor("github-copilot", "sonnet", "2026-08-31T23:59:59.999Z")).toMatchObject({ version: { id: january.id } });
    expect(history.priceFor("github-copilot", "sonnet", "2026-09-01T00:00:00.000Z")).toMatchObject({ version: { id: september.id } });
    expect(history.priceFor("github-copilot", "sonnet", "2026-09-01")).toMatchObject({ version: { id: september.id } });
  });

  it("is unknown with a reason before the first version", () => {
    expect(history.priceFor("github-copilot", "sonnet", "2025-12-31T23:59:59Z")).toEqual({
      known: false,
      reason: "no price for sonnet on github-copilot before 2026-01-01",
    });
  });

  it("is unknown with a reason inside a gap", () => {
    expect(history.priceFor("github-copilot", "sonnet", "2026-09-20T00:00:00Z")).toEqual({
      known: false,
      reason: "no price for sonnet on github-copilot between 2026-09-15 and 2026-10-01",
    });
  });

  it("is unknown with a reason after the last version ended", () => {
    const ended = book([january]);
    expect(ended.priceFor("github-copilot", "sonnet", "2026-10-01T00:00:00Z")).toEqual({
      known: false,
      reason: "no price for sonnet on github-copilot from 2026-09-01",
    });
  });

  it("is unknown for a model or channel it has no versions for, and for a time it can't read", () => {
    expect(history.priceFor("github-copilot", "gpt-x", "2026-10-02")).toEqual({
      known: false,
      reason: "no price for gpt-x on github-copilot",
    });
    expect(history.priceFor("openai-api", "gpt-x", "2026-10-02")).toEqual({
      known: false,
      reason: "no price book for channel openai-api",
    });
    expect(history.priceFor("github-copilot", "sonnet", "yesterday")).toEqual({
      known: false,
      reason: 'cannot price at "yesterday": not an ISO date or timestamp',
    });
  });

  describe("precedence: a contract version beats the list price only in its scope", () => {
    const list = entry({ effectiveFrom: "2026-01-01" });
    const everywhere = entry({ id: "c-all", kind: "contract", origin: "user", effectiveFrom: "2026-06-01", effectiveTo: "2026-07-01" });
    const project = entry({ id: "c-project", kind: "contract", origin: "user", scope: { projectId: "acme" }, effectiveFrom: "2026-03-01" });
    const repository = entry({
      id: "c-repo",
      kind: "contract",
      origin: "user",
      scope: { repository: "github.com/acme/web" },
      effectiveFrom: "2026-04-01",
    });
    const priced = book([list, everywhere, project, repository]);
    const id = (at: string, scope?: { projectId?: string; repositoryKey?: string }) => {
      const lookup = priced.priceFor("github-copilot", "sonnet", at, scope);
      return lookup.known ? lookup.version.id : lookup.reason;
    };

    it("uses the list price where no contract applies", () => {
      expect(id("2026-02-01")).toBe(list.id);
      expect(id("2026-03-15")).toBe(list.id);
      expect(id("2026-03-15", { projectId: "other" })).toBe(list.id);
    });

    it("uses an unscoped contract for every turn while it's in force", () => {
      expect(id("2026-06-15")).toBe("c-all");
      expect(id("2026-07-01")).toBe(list.id);
    });

    it("prefers a repository contract, then a project contract, then an unscoped one", () => {
      expect(id("2026-03-15", { projectId: "acme" })).toBe("c-project");
      expect(id("2026-06-15", { projectId: "acme" })).toBe("c-project");
      expect(id("2026-06-15", { projectId: "acme", repositoryKey: "github.com/acme/web" })).toBe("c-repo");
      expect(id("2026-03-15", { projectId: "acme", repositoryKey: "github.com/acme/web" })).toBe("c-project");
    });

    it("is unknown on a contract-only channel outside the contract's scope", () => {
      const reseller = book([entry({ id: "r", channel: "reseller", kind: "contract", origin: "user", scope: { projectId: "acme" } })]);
      expect(reseller.priceFor("reseller", "sonnet", "2026-05-01", { projectId: "acme" })).toMatchObject({ known: true });
      expect(reseller.priceFor("reseller", "sonnet", "2026-05-01")).toEqual({
        known: false,
        reason: "no price for sonnet on reseller: its contract prices don't apply to this turn",
      });
    });
  });
});

describe("PriceBook.newestVersion", () => {
  it("returns the latest list or promo version, ignoring contracts", () => {
    const contract = entry({ id: "c", kind: "contract", origin: "user", effectiveFrom: "2026-11-01" });
    expect(book([january, october, september, contract]).newestVersion("github-copilot", "sonnet")?.id).toBe(october.id);
    expect(book([january]).newestVersion("github-copilot", "gpt-x")).toBeUndefined();
  });
});

describe("PriceBook.list", () => {
  const other = entry({ modelId: "opus", sourceIds: ["other-doc"] });
  const otherSource: Source = { ...source, id: "other-doc" };
  const unused: Source = { ...source, id: "unused" };
  const listed = book([january, september, october, other], {
    sources: [source, otherSource, unused],
    problems: [{ path: "channels.priceVersions[0]", message: "overlaps" }],
  });

  it("lists every version, by channel, model and date, with the sources they cite, the gaps and the problems", () => {
    const listing = listed.list({});

    expect(priceBookListingSchema.parse(listing)).toEqual(listing);
    expect(listing.channels).toEqual(["github-copilot"]);
    expect(listing.versions.map((version) => version.id)).toEqual([other.id, january.id, september.id, october.id]);
    expect(listing.sources.map((cited) => cited.id)).toEqual(["doc", "other-doc"]);
    expect(listing.gaps).toEqual([{ channel: "github-copilot", modelId: "sonnet", from: "2026-09-15", to: "2026-10-01" }]);
    expect(listing.unknown).toEqual([]);
    expect(listing.problems).toHaveLength(1);
  });

  it("filters by channel and model", () => {
    expect(listed.list({ model: "opus" }).versions.map((version) => version.id)).toEqual([other.id]);
    expect(listed.list({ model: "opus" }).sources.map((cited) => cited.id)).toEqual(["other-doc"]);
    expect(listed.list({ channel: "openai-api" })).toMatchObject({
      versions: [],
      unknown: [{ channel: "openai-api", modelId: "*", reason: "no price book for channel openai-api" }],
    });
    expect(listed.list({ channel: "github-copilot", model: "gpt-x" }).unknown).toEqual([
      { channel: "github-copilot", modelId: "gpt-x", reason: "no price for gpt-x on github-copilot" },
    ]);
  });

  it("with `at`, keeps the versions in force then and names the models with none", () => {
    const atGap = listed.list({ at: "2026-09-20" });
    expect(atGap.versions.map((version) => version.id)).toEqual([other.id]);
    expect(atGap.unknown).toEqual([
      { channel: "github-copilot", modelId: "sonnet", reason: "no price for sonnet on github-copilot between 2026-09-15 and 2026-10-01" },
    ]);
  });

  it("with `at`, keeps every contract in force beside the list price, marked by kind and origin", () => {
    const contract = entry({ id: "c", kind: "contract", origin: "user", scope: { projectId: "acme" }, sourceIds: [] });
    const atContract = book([january, contract]).list({ at: "2026-05-01" });
    expect(atContract.versions.map((version) => [version.id, version.kind, version.origin])).toEqual([
      [january.id, "list", "bundled"],
      ["c", "contract", "user"],
    ]);
  });
});
