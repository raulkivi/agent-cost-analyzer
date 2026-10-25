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
});
