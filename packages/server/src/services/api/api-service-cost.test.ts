import { describe, expect, it } from "vitest";
import type { CostComparison, CostSeries } from "@agent-cost-analyzer/domain";
import { UnknownLogProviderIdError } from "../../data-sources/log-providers/registry.js";
import type { CostAnalysisQueries } from "../cost-analysis/cost-analysis-service.js";
import type { CostCompareRequest, CostSeriesRequest } from "../cost-analysis/cost-query-params.js";
import { ApiService, COST_ANALYSIS_UNAVAILABLE_MESSAGE, type ApiServiceDeps } from "./api-service.js";
import { BadRequestError, InternalError, NotFoundError } from "./api-errors.js";

// Phase 15 step 15.7: getCostTimeSeries and getCostComparison parse their
// query and call the cost analyses; a product without them answers 404.

const series = { turns: 0 } as CostSeries;
const comparison = { rows: [] } as unknown as CostComparison;

function service(costAnalysis?: Partial<CostAnalysisQueries>): ApiService {
  return new ApiService({ ...(costAnalysis ? { costAnalysis } : {}) } as ApiServiceDeps);
}

describe("ApiService cost analyses", () => {
  it("passes the parsed time-series query on", async () => {
    const requests: CostSeriesRequest[] = [];
    const api = service({ getTimeSeries: async (request) => (requests.push(request), series) });
    await expect(api.getCostTimeSeries({ groupBy: "project", ids: "a,b", bucket: "week", provider: "vscode" })).resolves.toBe(series);
    expect(requests).toEqual([{ groupBy: "project", ids: ["a", "b"], bucket: "week", basis: "preferred", pricing: "as-of-use", currency: "native", providerId: "vscode" }]);
  });

  it("passes the parsed comparison query on", async () => {
    const requests: CostCompareRequest[] = [];
    const api = service({ compare: async (request) => (requests.push(request), comparison) });
    await expect(api.getCostComparison({ groupBy: "repository", ids: "x,y", since: "2026-10-01", until: "2026-10-31" })).resolves.toBe(comparison);
    expect(requests[0]).toMatchObject({ groupBy: "repository", ids: ["x", "y"], comparePeriod: "previous" });
  });

  it("rejects a malformed query, and an unknown provider, as a bad request", async () => {
    const api = service({
      getTimeSeries: async () => {
        throw new UnknownLogProviderIdError("nope");
      },
      compare: async () => comparison,
    });
    await expect(api.getCostTimeSeries({ bucket: "year" })).rejects.toBeInstanceOf(BadRequestError);
    await expect(api.getCostComparison({ groupBy: "project", ids: "a" })).rejects.toBeInstanceOf(BadRequestError);
    await expect(api.getCostTimeSeries({ provider: "nope" })).rejects.toBeInstanceOf(BadRequestError);
  });

  it("reports any other failure as internal", async () => {
    const api = service({
      getTimeSeries: async () => {
        throw new Error("disk");
      },
    });
    await expect(api.getCostTimeSeries({})).rejects.toBeInstanceOf(InternalError);
  });

  it("is not found in a product without cost analyses (the extension, for now)", async () => {
    await expect(service().getCostTimeSeries({})).rejects.toEqual(new NotFoundError(COST_ANALYSIS_UNAVAILABLE_MESSAGE));
    await expect(service().getCostComparison({})).rejects.toEqual(new NotFoundError(COST_ANALYSIS_UNAVAILABLE_MESSAGE));
  });
});
