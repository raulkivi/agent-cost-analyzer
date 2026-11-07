// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { createUiFixtureStub } from "./ui-fixture-stub.js";
import { COPILOT_FIXTURE_ENV, FIRST_RUN_FIXTURE_ENV, S9_FIXTURE_ENV, UI_FIXTURE_ENV, parseFirstRunFixture, parseS9Fixture, parseUiFixture } from "./ui-fixture-env.mts";

describe("parseUiFixture (step 10.16)", () => {
  it("reads back what the config wrote", () => {
    const fixture = createUiFixtureStub();

    expect(parseUiFixture(JSON.stringify(fixture))).toEqual(fixture);
  });

  it("says how to run the specs when the variable is unset", () => {
    expect(() => parseUiFixture(undefined)).toThrow(new RegExp(`${UI_FIXTURE_ENV} is not set.*npm run test:ui:vscode`));
  });

  it.each([
    ["not JSON", "{"],
    ["not an object", "[]"],
  ])("rejects a value that is %s", (_name, raw) => {
    expect(() => parseUiFixture(raw)).toThrow(/Invalid UI fixture/);
  });

  it("names the missing field", () => {
    const withoutId: Partial<ReturnType<typeof createUiFixtureStub>> = createUiFixtureStub();
    delete withoutId.usageSessionId;

    expect(() => parseUiFixture(JSON.stringify(withoutId))).toThrow(/usageSessionId must be a non-empty string/);
  });

  it("rejects a non-integer count", () => {
    expect(() => parseUiFixture(JSON.stringify({ ...createUiFixtureStub(), largeSessionTurns: 1.5 }))).toThrow(/largeSessionTurns/);
  });

  it("names the variable it was asked to read, for the other launches' fixtures", () => {
    expect(() => parseUiFixture(undefined, COPILOT_FIXTURE_ENV)).toThrow(new RegExp(`${COPILOT_FIXTURE_ENV} is not set`));
    expect(() => parseUiFixture("{", COPILOT_FIXTURE_ENV)).toThrow(new RegExp(`${COPILOT_FIXTURE_ENV}: not JSON`));
  });
});

describe("parseFirstRunFixture (step 10.16)", () => {
  const fixture = { storagePath: "/tmp/aica-ui/first/storage", userDataDir: "/tmp/aica-ui/first/storage/settings", userSettings: { "update.mode": "none" } };

  it("reads back what the config wrote", () => {
    expect(parseFirstRunFixture(JSON.stringify(fixture))).toEqual(fixture);
  });

  it("says how to run the specs when the variable is unset", () => {
    expect(() => parseFirstRunFixture(undefined)).toThrow(new RegExp(`${FIRST_RUN_FIXTURE_ENV} is not set.*npm run test:ui:vscode`));
  });

  it("names the missing field", () => {
    expect(() => parseFirstRunFixture(JSON.stringify({ ...fixture, userDataDir: "" }))).toThrow(/userDataDir must be a non-empty string/);
  });
});

// Step 15.14: scenario S9's launch, with its workspace folder.
describe("parseS9Fixture", () => {
  const fixture = {
    storagePath: "/s9/storage",
    userDataDir: "/s9/storage/settings",
    userSettings: {},
    copilotHome: "/s9/copilot-home",
    workspacePath: "/s9/repos/portal-web",
    usageSessionId: "1c7604a0-1488-4b5d-880a-f80fd693475e",
    repositoryPaths: { portal: "/s9/repos/portal-web", billing: "/s9/repos/billing-api" },
  };

  it("reads back what the config wrote", () => {
    expect(parseS9Fixture(JSON.stringify(fixture))).toEqual(fixture);
  });

  it("says how to run the specs when the variable is unset", () => {
    expect(() => parseS9Fixture(undefined)).toThrow(new RegExp(`${S9_FIXTURE_ENV} is not set`));
  });

  it("rejects a fixture without its workspace folder", () => {
    expect(() => parseS9Fixture(JSON.stringify({ ...fixture, workspacePath: "" }))).toThrow(/workspacePath/);
  });
});
