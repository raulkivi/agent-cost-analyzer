// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/client";
import { monthlyAllowanceAnswerSchema, type AllowanceSettings, type Session } from "@agent-cost-analyzer/domain";
import { connectCostFixture, sessionOf, turnOf, usage } from "../test-support/cost-analysis-fixture.js";
import { EXTENSION_TOOL_GROUPS } from "./mcp-server.js";

// MS9 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/monthly-allowance-standalone.md §6, D7): get_monthly_allowance, the
// standalone server's read-only answer to "how much of my allowance is left?".
// The fixture's clock is 2026-11-06T12:00Z, so the period is November (UTC).

const SET: AllowanceSettings = { aiCredits: 100, resetDay: 1, warnAtPercent: 80 };

const billed = (id: string, startedAt: string, credits: number): Session => {
  const session = sessionOf(id, "vscode", "/home/dev/portal-web", [turnOf(0, startedAt, usage("claude-sonnet-5.5", {}))]);
  return { ...session, costAiCredits: { known: true, value: credits } };
};

const textOf = (result: { content: unknown }): string => (result.content as { text: string }[])[0]!.text;

describe("get_monthly_allowance (MS9)", () => {
  let client: Client | undefined;
  afterEach(async () => {
    await client?.close();
    client = undefined;
  });

  it("is a read-only tool without arguments, with the answer's output schema, in the standalone set only", async () => {
    ({ client } = await connectCostFixture({ allowance: SET }));
    const tool = (await client.listTools()).tools.find((entry) => entry.name === "get_monthly_allowance");

    expect(tool).toBeDefined();
    expect(tool!.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(tool!.inputSchema.properties ?? {}).toEqual({});
    expect(tool!.outputSchema?.type).toBe("object");
    expect(tool!.description).toMatch(/lower bound/i);
    expect(tool!.description).toMatch(/unknown is never 0/i);

    const extension = await connectCostFixture({ allowance: SET, toolGroups: EXTENSION_TOOL_GROUPS });
    try {
      expect((await extension.client.listTools()).tools.map((entry) => entry.name)).not.toContain("get_monthly_allowance");
    } finally {
      await extension.client.close();
    }
  });

  it("answers what GET /api/monthly-allowance answers on the same composition", async () => {
    const copilot = [billed("a", "2026-11-02T10:00:00.000Z", 40), billed("b", "2026-11-03T10:00:00.000Z", 41.4)];
    const fixture = await connectCostFixture({ allowance: SET, copilot });
    client = fixture.client;

    const result = await client.callTool({ name: "get_monthly_allowance", arguments: {} });
    const expected = await fixture.api.getMonthlyAllowance();

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual(expected);
    expect(monthlyAllowanceAnswerSchema.parse(result.structuredContent)).toMatchObject({ state: "known", figures: { used: 81.4, percent: 81, level: "near" } });
  });

  it("says it in one text answer built from the shared wording", async () => {
    ({ client } = await connectCostFixture({ allowance: SET, copilot: [billed("a", "2026-11-02T10:00:00.000Z", 40), billed("b", "2026-11-03T10:00:00.000Z", 41.4)] }));
    const text = textOf(await client.callTool({ name: "get_monthly_allowance", arguments: {} }));

    expect(text).toContain("81.40 of 100 AI Credits");
    expect(text).toContain("81 % of the allowance used");
    expect(text).toContain("25 days left");
    expect(text).toContain("2 of 2 sessions this month have cost data");
  });

  it("calls a lower bound 'at least' and keeps unknown out of the figures, never 0", async () => {
    const unknownSession = sessionOf("u", "vscode", "/home/dev/scratch", [turnOf(0, "2026-11-04T10:00:00.000Z", usage("gpt-6.1-sol", {}))]);
    ({ client } = await connectCostFixture({ allowance: SET, copilot: [billed("a", "2026-11-02T10:00:00.000Z", 10), unknownSession] }));
    const text = textOf(await client.callTool({ name: "get_monthly_allowance", arguments: {} }));

    expect(text).toMatch(/^At least 10\.00 of 100 AI Credits/);
    expect(text).toContain("1 of 2 sessions this month have cost data");
    await client.close();

    ({ client } = await connectCostFixture({ allowance: SET, copilot: [unknownSession] }));
    const none = await client.callTool({ name: "get_monthly_allowance", arguments: {} });
    expect(none.structuredContent).not.toHaveProperty("figures.used");
    expect(textOf(none)).toContain("unknown");
    expect(textOf(none)).toContain("Unknown is not 0");
  });

  it("says so when no allowance is set, with no figure", async () => {
    ({ client } = await connectCostFixture({ allowance: { ...SET, aiCredits: null } }));
    const result = await client.callTool({ name: "get_monthly_allowance", arguments: {} });

    expect(result.structuredContent).toMatchObject({ state: "not-set" });
    expect(textOf(result)).toMatch(/no monthly allowance is set/i);
  });
});
