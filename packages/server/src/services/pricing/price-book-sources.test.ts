// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyProjectsFile, type PriceVersion, type ProjectsFile } from "@agent-cost-analyzer/domain";
import { BundledPriceBookSource } from "./bundled-price-book-source.js";
import { CompositePriceBookSource } from "./composite-price-book-source.js";
import { UserPriceBookSource } from "./user-price-book-source.js";

const tier = { inputUsdPerM: 3, cachedInputUsdPerM: 0.3, cacheWriteUsdPerM: 3.75, outputUsdPerM: 15 };
const source = { id: "doc", title: "Doc", url: "https://example.com", checkedAt: "2026-11-05" };

function version(overrides: Partial<PriceVersion> = {}): PriceVersion {
  const channel = overrides.channel ?? "github-copilot";
  const modelId = overrides.modelId ?? "sonnet";
  const effectiveFrom = overrides.effectiveFrom ?? "2026-01-01";
  return {
    id: `${channel}:${modelId}:${effectiveFrom}`,
    channel,
    modelId,
    currency: "USD",
    effectiveFrom,
    tiers: [tier],
    kind: "list",
    sourceIds: ["doc"],
    ...overrides,
  };
}

describe("BundledPriceBookSource", () => {
  let dir: string;
  const write = (file: string, content: unknown): void =>
    writeFileSync(path.join(dir, file), typeof content === "string" ? content : JSON.stringify(content));
  const channelFile = (channel: string, versions: PriceVersion[], sources = [source]) => ({ channel, sources, versions });

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "price-book-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads every channel file, marking versions bundled and keeping their sources", () => {
    write("github-copilot.json", channelFile("github-copilot", [version()]));
    write("anthropic-api.json", channelFile("anthropic-api", [version({ channel: "anthropic-api" })]));
    write("notes.md", "not json");

    const data = new BundledPriceBookSource(dir).load();

    expect(data.versions.map((entry) => [entry.channel, entry.origin])).toEqual([
      ["anthropic-api", "bundled"],
      ["github-copilot", "bundled"],
    ]);
    expect(data.sources).toEqual([source]);
    expect(data.problems).toEqual([]);
  });

  it("returns an empty book for an empty directory", () => {
    expect(new BundledPriceBookSource(dir).load()).toEqual({ versions: [], sources: [], problems: [] });
  });

  const failures: [string, () => void, RegExp][] = [
    ["a file failing the schema", () => write("github-copilot.json", { channel: "github-copilot" }), /github-copilot\.json.*invalid/],
    ["a file named after another channel", () => write("openai-api.json", channelFile("github-copilot", [version()])), /openai-api\.json.*"github-copilot"/],
    [
      "a version on another channel than its file",
      () => write("github-copilot.json", channelFile("github-copilot", [version({ channel: "openai-api" })])),
      /channel "openai-api"/,
    ],
    ["a version with no source", () => write("github-copilot.json", channelFile("github-copilot", [version({ sourceIds: [] })])), /cites no source/],
    [
      "a version citing an unknown source",
      () => write("github-copilot.json", channelFile("github-copilot", [version({ sourceIds: ["missing"] })])),
      /unknown source "missing"/,
    ],
    [
      "a contract version (those are the user's)",
      () => write("github-copilot.json", channelFile("github-copilot", [version({ kind: "contract" })])),
      /contract/,
    ],
    [
      "two versions with one id",
      () => write("github-copilot.json", channelFile("github-copilot", [version(), version({ modelId: "opus", id: "github-copilot:sonnet:2026-01-01" })])),
      /used twice/,
    ],
    [
      "overlapping versions of one model",
      () =>
        write(
          "github-copilot.json",
          channelFile("github-copilot", [version(), version({ effectiveFrom: "2026-06-01" })]),
        ),
      /overlap/,
    ],
  ];

  for (const [name, arrange, message] of failures) {
    it(`fails fast on ${name}`, () => {
      arrange();
      expect(() => new BundledPriceBookSource(dir)).toThrow(message);
    });
  }

  it("rejects two files citing one source id with different details", () => {
    write("github-copilot.json", channelFile("github-copilot", [version()]));
    write("openai-api.json", channelFile("openai-api", [version({ channel: "openai-api" })], [{ ...source, title: "Other" }]));
    expect(() => new BundledPriceBookSource(dir)).toThrow(/source "doc"/);
  });

  it("allows a gap between versions", () => {
    write(
      "github-copilot.json",
      channelFile("github-copilot", [version({ effectiveTo: "2026-03-01" }), version({ effectiveFrom: "2026-04-01" })]),
    );
    expect(new BundledPriceBookSource(dir).load().versions).toHaveLength(2);
  });
});

describe("UserPriceBookSource", () => {
  it("reads channels.priceVersions from the projects file on every load, marking them user", () => {
    let file: ProjectsFile = emptyProjectsFile();
    const user = new UserPriceBookSource(() => file);
    expect(user.load()).toEqual({ versions: [], sources: [], problems: [] });

    file = { ...emptyProjectsFile(), channels: { priceVersions: [version({ kind: "contract", sourceIds: [] })] } };
    expect(user.load().versions).toEqual([{ ...version({ kind: "contract", sourceIds: [] }), origin: "user" }]);
  });
});

describe("CompositePriceBookSource", () => {
  const bundled = { load: () => ({ versions: [{ ...version(), origin: "bundled" as const }], sources: [source], problems: [] }) };
  const userOf = (versions: PriceVersion[]) => ({
    load: () => ({ versions: versions.map((entry) => ({ ...entry, origin: "user" as const })), sources: [], problems: [] }),
  });

  it("puts bundled versions first and user versions after", () => {
    const contract = version({ id: "c", kind: "contract", sourceIds: [] });
    const data = new CompositePriceBookSource([bundled, userOf([contract])]).load();

    expect(data.versions.map((entry) => [entry.id, entry.origin])).toEqual([
      ["github-copilot:sonnet:2026-01-01", "bundled"],
      ["c", "user"],
    ]);
    expect(data.sources).toEqual([source]);
    expect(data.problems).toEqual([]);
  });

  it("leaves out a user list price overlapping a bundled one, and a user id the book already has, saying why", () => {
    const overlapping = version({ id: "mine", effectiveFrom: "2026-06-01" });
    const sameId = version({ modelId: "opus", id: "github-copilot:sonnet:2026-01-01" });
    const earlier = version({ id: "history", effectiveFrom: "2025-01-01", effectiveTo: "2026-01-01" });
    const data = new CompositePriceBookSource([bundled, userOf([overlapping, sameId, earlier])]).load();

    expect(data.versions.map((entry) => entry.id)).toEqual(["github-copilot:sonnet:2026-01-01", "history"]);
    expect(data.problems).toEqual([
      { path: "channels.priceVersions[0]", message: expect.stringMatching(/"mine" overlaps "github-copilot:sonnet:2026-01-01"/) },
      { path: "channels.priceVersions[1].id", message: expect.stringMatching(/already in the price book/) },
    ]);
  });

  it("passes on the problems its sources report", () => {
    const failing = { load: () => ({ versions: [], sources: [], problems: [{ path: "x", message: "y" }] }) };
    expect(new CompositePriceBookSource([bundled, failing]).load().problems).toEqual([{ path: "x", message: "y" }]);
  });
});
