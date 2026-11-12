// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { TokenCount } from "@agent-cost-analyzer/domain";
import { describeExchangeUsage, describeTurnUsage } from "./turn-usage-sentence.js";

const known = (value: number): TokenCount => ({ known: true, value });
const unknown: TokenCount = { known: false, reason: "not logged" };

const base = { uncachedInput: known(18), cacheWrite: known(0), cacheRead: known(0), output: known(535), model: "gpt-6-luna" };

describe("describeTurnUsage", () => {
  it("mentions cache write and cache read when both are present", () => {
    expect(describeTurnUsage({ ...base, cacheWrite: known(25815), cacheRead: known(110484) })).toBe(
      `This turn sent 18 new input tokens, wrote ${(25815).toLocaleString()} to cache and reused ${(110484).toLocaleString()} from cache, producing 535 output tokens using gpt-6-luna.`,
    );
  });

  it("omits cache parts that are zero", () => {
    expect(describeTurnUsage(base)).toBe("This turn sent 18 new input tokens, producing 535 output tokens using gpt-6-luna.");
  });

  it("omits cache parts that are unknown instead of showing 0", () => {
    expect(describeTurnUsage({ ...base, cacheWrite: unknown, cacheRead: unknown })).not.toMatch(/cache/);
  });

  it("shows only cache read when there is no cache write", () => {
    expect(describeTurnUsage({ ...base, cacheRead: known(800) })).toBe(
      "This turn sent 18 new input tokens and reused 800 from cache, producing 535 output tokens using gpt-6-luna.",
    );
  });

  it("shows only cache write when there is no cache read", () => {
    expect(describeTurnUsage({ ...base, cacheWrite: known(1) })).toBe(
      "This turn sent 18 new input tokens and wrote 1 to cache, producing 535 output tokens using gpt-6-luna.",
    );
  });

  it("uses the singular for exactly one token", () => {
    expect(describeTurnUsage({ ...base, uncachedInput: known(1), output: known(1) })).toBe(
      "This turn sent 1 new input token, producing 1 output token using gpt-6-luna.",
    );
  });
});

describe("describeTurnUsage with subagent runs (step 10.19)", () => {
  const run = (costAiCredits: TokenCount) => ({ costAiCredits });
  const plain = "This turn sent 18 new input tokens, producing 535 output tokens using gpt-6-luna";

  it("names the AI Credits and the number of subagent runs", () => {
    expect(describeTurnUsage({ ...base, subagents: [run(known(40)), run(known(2.5))] })).toBe(
      `${plain}, incl. 42.5 AI Credits from 2 subagent runs.`,
    );
  });

  it("uses the singular for one run", () => {
    expect(describeTurnUsage({ ...base, subagents: [run(known(42.06))] })).toBe(`${plain}, incl. 42.06 AI Credits from 1 subagent run.`);
  });

  it("names the runs without a figure when any run's AI Credits are unknown, never 0", () => {
    const sentence = describeTurnUsage({ ...base, subagents: [run(known(40)), run(unknown)] });
    expect(sentence).toBe(`${plain}, incl. 2 subagent runs (their AI Credits are unknown).`);
    expect(sentence).not.toMatch(/\b0 AI Credits/);
  });

  it("is unchanged without runs", () => {
    expect(describeTurnUsage({ ...base, subagents: [] })).toBe(`${plain}.`);
    expect(describeTurnUsage(base)).toBe(`${plain}.`);
  });
});

describe("describeExchangeUsage", () => {
  it("keeps the exchange wording with proper plurals", () => {
    expect(describeExchangeUsage({ ...base, uncachedInput: known(1) })).toBe(
      "This exchange sent 1 input token and produced 535 output tokens using gpt-6-luna.",
    );
  });
});
