import { describe, expect, it } from "vitest";
import { INTEGRATION_FIXTURE_ENV, parseIntegrationFixture } from "./integration-fixture-env.mts";

const fixture = {
  userDataDir: "/tmp/aica-it-1/user-data",
  usageSessionId: "1c7604a0-1488-4b5d-880a-f80fd693475e",
  usageSessionTitle: "Fix the bug",
  sessionCount: 200,
};

describe("parseIntegrationFixture (step 10.9)", () => {
  it("names the environment variable .vscode-test.mjs sets", () => {
    expect(INTEGRATION_FIXTURE_ENV).toBe("AI_CREDITS_ANALYZER_INTEGRATION_FIXTURE");
  });

  it("reads the fixture back from its JSON", () => {
    expect(parseIntegrationFixture(JSON.stringify(fixture))).toEqual(fixture);
  });

  it("says how to run the suite when the variable is missing", () => {
    expect(() => parseIntegrationFixture(undefined)).toThrow(/AI_CREDITS_ANALYZER_INTEGRATION_FIXTURE is not set.*npm run test:integration/);
  });

  it.each([
    ["not JSON", "{"],
    ["not an object", "[]"],
    ["a field missing", JSON.stringify({ ...fixture, usageSessionId: undefined })],
    ["a relative user-data dir", JSON.stringify({ ...fixture, userDataDir: "user-data" })],
    ["a session count that isn't a positive integer", JSON.stringify({ ...fixture, sessionCount: 0 })],
  ])("refuses %s", (_label, raw) => {
    expect(() => parseIntegrationFixture(raw)).toThrow(/integration fixture/i);
  });
});
