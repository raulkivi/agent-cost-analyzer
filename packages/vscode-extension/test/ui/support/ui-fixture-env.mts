// How the UI fixtures reach the specs (step 10.16): wdio.conf.mts creates them
// (scripts/ui-automation/ui-fixture.mts) and passes each as JSON in an
// environment variable, which the wdio workers inherit. No imports beyond
// types, so both Node (the config) and the specs can load it.
import type { FirstRunFixture, UiFixture } from "../../../scripts/ui-automation/ui-fixture.mts";

// The main launch: sessions, Copilot Chat absent.
export const UI_FIXTURE_ENV = "AI_CREDITS_ANALYZER_UI_FIXTURE";
// The launch with the built-in Copilot Chat enabled, unsigned (checks 1.2, 1.4).
export const COPILOT_FIXTURE_ENV = "AI_CREDITS_ANALYZER_UI_COPILOT_FIXTURE";
// The launch that has never seen Copilot Chat (checks 1.1-1.3).
export const FIRST_RUN_FIXTURE_ENV = "AI_CREDITS_ANALYZER_UI_FIRST_RUN_FIXTURE";
// The launch with Workspace Trust on and a folder (check 2.5).
export const TRUST_FIXTURE_ENV = "AI_CREDITS_ANALYZER_UI_TRUST_FIXTURE";
// The profile that has the analyzer installed from its VSIX, then uninstalled (check 1.12).
export const UNINSTALL_FIXTURE_ENV = "AI_CREDITS_ANALYZER_UI_UNINSTALL_FIXTURE";

function parseObject(raw: string | undefined, envName: string): Record<string, unknown> {
  if (raw === undefined || raw === "") {
    throw new Error(`${envName} is not set: run the specs with \`npm run test:ui:vscode\`, which seeds the UI fixture`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid UI fixture in ${envName}: not JSON`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid UI fixture in ${envName}: not an object`);
  }
  return value as Record<string, unknown>;
}

function requireStrings(value: Record<string, unknown>, keys: readonly string[], envName: string): void {
  for (const key of keys) {
    if (typeof value[key] !== "string" || value[key] === "") {
      throw new Error(`Invalid UI fixture in ${envName}: ${key} must be a non-empty string`);
    }
  }
  if (typeof value.userSettings !== "object" || value.userSettings === null) {
    throw new Error(`Invalid UI fixture in ${envName}: userSettings must be an object`);
  }
}

// The fixture from the variable's value; throws with what's wrong, so a
// spec started some other way fails with a clear message.
export function parseUiFixture(raw: string | undefined, envName: string = UI_FIXTURE_ENV): UiFixture {
  const value = parseObject(raw, envName);
  requireStrings(value, ["storagePath", "userDataDir", "copilotHome", "usageSessionId", "usageSessionTitle", "largeSessionId", "systemPromptMarker"], envName);
  for (const key of ["largeSessionTurns", "listedSessionCount"] as const) {
    const count = value[key];
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
      throw new Error(`Invalid UI fixture in ${envName}: ${key} must be a positive integer`);
    }
  }
  return value as unknown as UiFixture;
}

export function parseFirstRunFixture(raw: string | undefined, envName: string = FIRST_RUN_FIXTURE_ENV): FirstRunFixture {
  const value = parseObject(raw, envName);
  requireStrings(value, ["storagePath", "userDataDir"], envName);
  return value as unknown as FirstRunFixture;
}
