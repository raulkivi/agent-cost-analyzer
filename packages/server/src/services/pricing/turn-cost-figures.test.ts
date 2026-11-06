import { describe, expect, it } from "vitest";
import { turnCostFiguresSchema, type CostFigure } from "@agent-cost-analyzer/domain";
import { analyzeSession, turn, usage } from "../../test-support/insights-fakes.js";
import type { Attribution } from "../cost-attribution/session-attributor.js";
import type { PricingRequest } from "./cost-pricer.js";
import { billedFigure, pricingPolicyFor, reportedFigure, TurnCostFigureBuilder } from "./turn-cost-figures.js";

// Step 15.6: a turn's three cost bases, from its usage and the pricer.

const attribution: Attribution = {
  repository: { attributed: true, repository: { key: "github.com/acme/app", source: "git-remote" } },
  projectId: "acme",
  vendor: { known: true, vendorId: "anthropic", basis: "profile" },
  channel: { known: true, channel: "anthropic-api" },
};

const PRICED: CostFigure = { known: true, amount: 1, currency: "USD", basis: "priced", priceVersionIds: ["v"] };

function recordingPricer() {
  const requests: PricingRequest[] = [];
  return {
    requests,
    pricer: {
      price: (request: PricingRequest) => {
        requests.push(request);
        return PRICED;
      },
    },
  };
}

describe("billedFigure", () => {
  it("is Copilot's billed AI Credits when the log records them", () => {
    expect(billedFigure(usage({ credits: 2.5 }))).toEqual({ known: true, amount: 2.5, currency: "AI_CREDITS", basis: "billed" });
  });

  it("is unknown with the usage's own reason otherwise", () => {
    expect(billedFigure(usage({ credits: null }))).toEqual({ known: false, reason: "not recorded" });
  });
});

describe("reportedFigure", () => {
  it("is the agent's own USD cost when it logs one", () => {
    expect(reportedFigure({ ...usage(), reportedCostUsd: { known: true, value: 0.4 } })).toEqual({
      known: true,
      amount: 0.4,
      currency: "USD",
      basis: "reported",
    });
  });

  it("is unknown, with a reason, when the provider logs no cost or an incomplete one", () => {
    expect(reportedFigure(usage())).toEqual({ known: false, reason: "This provider logs no cost of its own." });
    expect(reportedFigure({ ...usage(), reportedCostUsd: { known: false, reason: "no cost.total" } })).toEqual({ known: false, reason: "no cost.total" });
  });
});

describe("pricingPolicyFor", () => {
  it("prices Claude Code's unsplit cache writes at the 1-hour rate and labels it API-equivalent", () => {
    expect(pricingPolicyFor("claude-code")).toEqual({ defaultCacheWriteLifetime: "extended", apiEquivalent: true, uncachedIncludesUnknownCacheWrite: false });
  });

  it("keeps Copilot on the standard (5-minute) write rate, its writes inside uncached input when unknown", () => {
    expect(pricingPolicyFor("vscode")).toEqual({ defaultCacheWriteLifetime: "standard", apiEquivalent: false, uncachedIncludesUnknownCacheWrite: true });
  });

  it("uses the API's standard write rate for pi, mitmproxy and any other provider", () => {
    for (const id of ["pi-agent", "mitmproxy", "other"]) {
      expect(pricingPolicyFor(id)).toEqual({ defaultCacheWriteLifetime: "standard", apiEquivalent: false, uncachedIncludesUnknownCacheWrite: false });
    }
  });
});

describe("TurnCostFigureBuilder", () => {
  it("asks the pricer with the turn's time, session start, channel, scope and the provider's policy", () => {
    const { requests, pricer } = recordingPricer();
    const t = { ...turn(0), startedAt: "2026-10-08T12:00:00Z" };
    const session = analyzeSession("s1", "2026-10-08T11:00:00Z", [t]);
    const figures = new TurnCostFigureBuilder(pricer).figuresFor("claude-code", session, t, attribution);

    expect(turnCostFiguresSchema.parse(figures)).toEqual({ billed: billedFigure(t.usage), reported: reportedFigure(t.usage), priced: PRICED });
    expect(requests[0]).toEqual({
      usage: t.usage,
      channel: attribution.channel,
      turnStartedAt: "2026-10-08T12:00:00Z",
      sessionStartedAt: "2026-10-08T11:00:00Z",
      scope: { projectId: "acme", repositoryKey: "github.com/acme/app" },
      ...pricingPolicyFor("claude-code"),
    });
  });

  it("gives an Unattributed turn no scope", () => {
    const { requests, pricer } = recordingPricer();
    const t = turn(0);
    new TurnCostFigureBuilder(pricer).figuresFor("pi-agent", analyzeSession("s", undefined, [t]), t, {
      ...attribution,
      repository: { attributed: false, reason: "no folder" },
      projectId: null,
    });
    expect(requests[0]!.scope).toEqual({});
  });

  it("without a price book, the priced figure is unknown with a reason, never 0", () => {
    const t = turn(0);
    const figures = new TurnCostFigureBuilder().figuresFor("vscode", analyzeSession("s", undefined, [t]), t, attribution);
    expect(figures.priced).toEqual({ known: false, reason: "No price book is configured for this product, so no turn is priced." });
    expect(figures.billed.known).toBe(true);
  });
});
