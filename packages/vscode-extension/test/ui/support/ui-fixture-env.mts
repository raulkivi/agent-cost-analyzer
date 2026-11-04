// How the UI fixture reaches the specs (step 10.16): wdio.conf.mts creates it
// (scripts/ui-automation/ui-fixture.mts) and passes it as JSON in this
// environment variable, which the wdio workers inherit. No imports beyond
// types, so both Node (the config) and the specs can load it.
import type { UiFixture } from "../../../scripts/ui-automation/ui-fixture.mts";

export const UI_FIXTURE_ENV = "AI_CREDITS_ANALYZER_UI_FIXTURE";

// The fixture from the variable's value; throws with what's wrong, so a
// spec started some other way fails with a clear message.
export function parseUiFixture(raw: string | undefined): UiFixture {
  if (raw === undefined || raw === "") {
    throw new Error(`${UI_FIXTURE_ENV} is not set: run the specs with \`npm run test:ui:vscode\`, which seeds the UI fixture`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid UI fixture in ${UI_FIXTURE_ENV}: not JSON`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid UI fixture in ${UI_FIXTURE_ENV}: not an object`);
  }
  const fixture = value as Partial<UiFixture>;
  for (const key of ["storagePath", "userDataDir", "copilotHome", "usageSessionId", "usageSessionTitle", "largeSessionId", "systemPromptMarker"] as const) {
    if (typeof fixture[key] !== "string" || fixture[key] === "") {
      throw new Error(`Invalid UI fixture in ${UI_FIXTURE_ENV}: ${key} must be a non-empty string`);
    }
  }
  for (const key of ["largeSessionTurns", "listedSessionCount"] as const) {
    if (typeof fixture[key] !== "number" || !Number.isInteger(fixture[key]) || fixture[key] < 1) {
      throw new Error(`Invalid UI fixture in ${UI_FIXTURE_ENV}: ${key} must be a positive integer`);
    }
  }
  if (typeof fixture.userSettings !== "object" || fixture.userSettings === null) {
    throw new Error(`Invalid UI fixture in ${UI_FIXTURE_ENV}: userSettings must be an object`);
  }
  return fixture as UiFixture;
}
