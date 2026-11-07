// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { COPILOT_MCP_IDENTITY } from "../composition/create-copilot-mcp-services.js";
import { STANDALONE_MCP_IDENTITY } from "./mcp-identity.js";

// Phase 15 step 15.13 (plan §10.1.4): what the model reads on connect, for
// both products: the cost workflow, the three cost bases and what priced
// figures depend on, as-of-use versus today's prices, the one conversion,
// and (standalone only) that statements are issued in the app.

describe.each([
  ["the standalone server", STANDALONE_MCP_IDENTITY.instructions],
  ["the extension's server", COPILOT_MCP_IDENTITY.instructions],
])("%s's instructions (step 15.13)", (_label, text) => {
  it("give the cost workflow: repositories or projects, then project cost or a comparison, then why it changed", () => {
    const at = (name: string) => text.indexOf(name);
    for (const name of ["list_repositories", "list_projects", "get_project_cost", "compare_costs", "explain_cost_change"]) expect(text).toContain(name);
    expect(at("list_repositories")).toBeLessThan(at("get_project_cost"));
    expect(at("get_project_cost")).toBeLessThan(at("explain_cost_change"));
  });

  it("say what billed, reported and priced mean, and that priced figures depend on the price book", () => {
    expect(text).toMatch(/billed/);
    expect(text).toMatch(/reported/);
    expect(text).toMatch(/priced/);
    expect(text).toContain("get_price_book");
  });

  it("tell as-of-use prices from today's prices", () => {
    expect(text).toMatch(/as of use/i);
    expect(text).toMatch(/today's prices/i);
  });

  it("give the only conversion: 1 AI Credit = $0.01, and no other exchange rate", () => {
    expect(text).toContain("1 AI Credit = $0.01");
    expect(text).toMatch(/no other exchange rate/i);
  });
});

describe("the products' differences in the instructions (step 15.13)", () => {
  it("the standalone server says statements are issued only in the app, and estimates are ranges", () => {
    expect(STANDALONE_MCP_IDENTITY.instructions).toMatch(/get_statement.*issued only in the app/s);
    expect(STANDALONE_MCP_IDENTITY.instructions).toMatch(/estimate_cost.*range/s);
  });

  it("the extension's server names no billing tool and says projects come from the standalone app (D7, D19)", () => {
    expect(COPILOT_MCP_IDENTITY.instructions).not.toMatch(/get_statement|estimate_cost/);
    expect(COPILOT_MCP_IDENTITY.instructions).toMatch(/no projects/i);
    expect(COPILOT_MCP_IDENTITY.instructions).not.toMatch(/Claude Code|\bpi\b|mitmproxy/i);
  });
});
