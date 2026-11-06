import { describe, expect, it } from "vitest";
import { insightsDatasetSchema } from "@agent-cost-analyzer/domain";
import type { LogProvider } from "../../data-sources/log-providers/log-provider.js";
import { UnknownLogProviderIdError } from "../../data-sources/log-providers/registry.js";
import { FakeProvider } from "../../test-support/audit-fakes.js";
import { analyzeSession, bash, turn } from "../../test-support/insights-fakes.js";
import { InsightsService } from "./insights-service.js";
import type { FindingDetector } from "./finding-detector.js";

const NOW = new Date("2026-10-11T08:00:00.000Z");

function labelled(provider: FakeProvider, label: string): FakeProvider {
  return Object.assign(provider, { label });
}

class UnavailableProvider extends FakeProvider {
  override async checkAvailability() {
    return { available: false, unavailableReason: "No captures directory" };
  }
}

class BrokenProvider extends FakeProvider {
  override async listSessions(): Promise<never[]> {
    throw new Error("database is locked");
  }
}

function service(providers: LogProvider[], detectors: FindingDetector[] = []) {
  return new InsightsService({ listProviders: () => providers }, detectors, () => NOW);
}

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T10:00:00.000Z`;

describe("InsightsService", () => {
  it("combines every available provider into one dataset", async () => {
    const a = labelled(new FakeProvider("a", [analyzeSession("s1", day(1), [turn(0, [bash("ls")])])]), "Provider A");
    const b = labelled(new FakeProvider("b", [analyzeSession("s1", day(2), [turn(0)])]), "Provider B");

    const dataset = await service([a, b]).getDataset({});

    expect(insightsDatasetSchema.parse(dataset)).toEqual(dataset);
    expect(dataset.generatedAt).toBe(NOW.toISOString());
    expect(dataset.sessions.map((session) => [session.key, session.providerLabel])).toEqual([
      ["a:s1", "Provider A"],
      ["b:s1", "Provider B"],
    ]);
    expect(dataset.toolCalls).toHaveLength(1);
    expect(dataset.providers).toEqual([
      { id: "a", label: "Provider A", available: true, sessionCount: 1, truncated: false },
      { id: "b", label: "Provider B", available: true, sessionCount: 1, truncated: false },
    ]);
  });

  it("attributes the rows through the injected attributor and names the projects and vendors they use (step 15.4)", async () => {
    const a = new FakeProvider("vscode", [analyzeSession("s1", day(1), [turn(0)])]);
    const attribution = {
      snapshot: () => ({
        session: () => attributed,
        turn: () => attributed,
        projectName: (id: string) => (id === "portal" ? "Customer portal" : undefined),
        vendorLabel: (id: string) => (id === "anthropic" ? "Anthropic" : id),
      }),
    };
    const attributed = {
      repository: { attributed: true as const, repository: { key: "github.com/acme/portal", source: "git-remote" as const } },
      projectId: "portal",
      vendor: { known: true as const, vendorId: "anthropic", basis: "profile" as const },
      channel: { known: true as const, channel: "github-copilot" },
    };

    const dataset = await new InsightsService({ listProviders: () => [a] }, [], () => NOW, attribution).getDataset({});

    expect(insightsDatasetSchema.parse(dataset)).toEqual(dataset);
    expect(dataset.turns[0]).toMatchObject({ repositoryKey: "github.com/acme/portal", projectId: "portal" });
    expect(dataset.projects).toEqual([{ id: "portal", name: "Customer portal" }]);
    expect(dataset.vendors).toEqual([{ id: "anthropic", label: "Anthropic" }]);
  });

  // Step 15.9 (plan §11.7): a project's chart colour is its position in the
  // projects file, so the dataset lists every project in file order, used
  // or not, and filtering or another date range never repaints one.
  it("lists the projects in projects-file order, including ones no row uses", async () => {
    const a = new FakeProvider("vscode", [analyzeSession("s1", day(1), [turn(0)])]);
    const attributed = {
      repository: { attributed: true as const, repository: { key: "github.com/acme/portal", source: "git-remote" as const } },
      projectId: "portal",
      vendor: { known: true as const, vendorId: "anthropic", basis: "profile" as const },
      channel: { known: true as const, channel: "github-copilot" },
    };
    const projects = [
      { id: "zeta", name: "Zeta", members: [] },
      { id: "portal", name: "Customer portal", members: [] },
      { id: "alpha", name: "Alpha", members: [] },
    ];
    const attribution = {
      snapshot: () => ({
        projectsFile: { version: 1 as const, projects },
        session: () => attributed,
        turn: () => attributed,
        projectName: (id: string) => projects.find((project) => project.id === id)?.name,
        vendorLabel: (id: string) => id,
      }),
    };

    const dataset = await new InsightsService({ listProviders: () => [a] }, [], () => NOW, attribution as never).getDataset({});

    expect(dataset.projects?.map((project) => project.id)).toEqual(["zeta", "portal", "alpha"]);
  });

  it("prices every turn row with the injected pricer, seeing each turn's attribution (step 15.6)", async () => {
    const a = new FakeProvider("vscode", [analyzeSession("s1", day(1), [turn(0)])]);
    const seen: string[] = [];
    const pricer = {
      figuresFor: (providerId: string, _session: unknown, _turn: unknown, attribution: { projectId: string | null }) => {
        seen.push(`${providerId}:${attribution.projectId}`);
        return {
          billed: { known: false as const, reason: "x" },
          reported: { known: false as const, reason: "x" },
          priced: { known: true as const, amount: 3, currency: "USD" as const, basis: "priced" as const, priceVersionIds: ["v"] },
        };
      },
    };
    const dataset = await new InsightsService({ listProviders: () => [a] }, [], () => NOW, undefined, { snapshot: () => pricer }).getDataset({});
    expect(insightsDatasetSchema.parse(dataset)).toEqual(dataset);
    expect(dataset.turns[0]!.cost?.priced).toMatchObject({ amount: 3 });
    expect(dataset.sessions[0]!.cost?.priced.usd).toBe(3);
    expect(seen).toEqual(["vscode:null"]);
  });

  it("prices with the pricing mode a caller asks for, as of use by default (step 15.7)", async () => {
    const a = new FakeProvider("vscode", [analyzeSession("s1", day(1), [turn(0)])]);
    const modes: (string | undefined)[] = [];
    const figures = {
      figuresFor: () => ({
        billed: { known: false as const, reason: "x" },
        reported: { known: false as const, reason: "x" },
        priced: { known: false as const, reason: "x" },
      }),
    };
    const insights = new InsightsService({ listProviders: () => [a] }, [], () => NOW, undefined, {
      snapshot: (mode?: string) => (modes.push(mode), figures),
    });
    await insights.getDataset({});
    await insights.getDataset({}, { pricing: "today" });
    expect(modes).toEqual(["as-of-use", "today"]);
  });

  it("reports an unavailable provider and keeps loading the others", async () => {
    const ok = new FakeProvider("ok", [analyzeSession("s1", day(1), [])]);
    const off = new UnavailableProvider("off", [analyzeSession("x", day(1), [])]);

    const dataset = await service([ok, off]).getDataset({});

    expect(dataset.sessions.map((session) => session.key)).toEqual(["ok:s1"]);
    expect(dataset.providers[1]).toMatchObject({
      id: "off",
      available: false,
      unavailableReason: "No captures directory",
      sessionCount: 0,
    });
  });

  it("records a provider that fails while loading without failing the whole dataset", async () => {
    const ok = new FakeProvider("ok", [analyzeSession("s1", day(1), [])]);
    const broken = new BrokenProvider("broken", []);

    const dataset = await service([broken, ok]).getDataset({});

    expect(dataset.sessions.map((session) => session.key)).toEqual(["ok:s1"]);
    expect(dataset.providers[0]).toMatchObject({ id: "broken", sessionCount: 0, error: "database is locked" });
  });

  it("applies the date range and a per-provider limit to the most recent sessions", async () => {
    const provider = new FakeProvider(
      "p",
      [1, 2, 3, 4, 5].map((n) => analyzeSession(`s${n}`, day(n), [])),
    );

    const dataset = await service([provider]).getDataset({ since: "2026-10-02", until: "2026-10-05", limit: 2 });

    expect(dataset.sessions.map((session) => session.sessionId)).toEqual(["s5", "s4"]);
    expect(dataset.providers[0]).toMatchObject({ sessionCount: 2, truncated: true });
    expect(dataset).toMatchObject({ since: "2026-10-02", until: "2026-10-05" });
    expect(provider.reads).toBe(2);
  });

  it("restricts to one provider when asked, and rejects an unknown one", async () => {
    const a = new FakeProvider("a", [analyzeSession("s1", day(1), [])]);
    const b = new FakeProvider("b", [analyzeSession("s1", day(1), [])]);

    const dataset = await service([a, b]).getDataset({ providerId: "b" });

    expect(dataset.providers.map((provider) => provider.id)).toEqual(["b"]);
    await expect(service([a, b]).getDataset({ providerId: "nope" })).rejects.toBeInstanceOf(UnknownLogProviderIdError);
  });

  it("runs every injected detector over the combined rows", async () => {
    const provider = new FakeProvider("p", [analyzeSession("s1", day(1), [turn(0)])]);
    const detector: FindingDetector = {
      detect: ({ rows }) =>
        rows.sessions.map((session) => ({
          key: `${session.key}:x`,
          sessionKey: session.key,
          kind: "anomaly" as const,
          category: "test",
          severity: "info" as const,
          ruleId: "test.x",
          title: "x",
          why: "because",
        })),
    };

    const dataset = await service([provider], [detector, detector]).getDataset({});

    expect(dataset.findings.map((finding) => finding.key)).toEqual(["p:s1:x", "p:s1:x"]);
  });

  // Step 15.10: an observed-price-change detector must know the rows' pricing mode.
  it("tells each detector which pricing mode the rows were priced in", async () => {
    const provider = new FakeProvider("p", [analyzeSession("s1", day(1), [turn(0)])]);
    const seen: (string | undefined)[] = [];
    const detector: FindingDetector = { detect: ({ pricing }) => (seen.push(pricing), []) };
    await service([provider], [detector]).getDataset({});
    await service([provider], [detector]).getDataset({}, { pricing: "today" });
    expect(seen).toEqual(["as-of-use", "today"]);
  });
});
