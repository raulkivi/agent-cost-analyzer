// How the integration fixture reaches the suite (step 10.9):
// .vscode-test.mjs creates it (integration-fixture.mts) and passes it as JSON
// in this environment variable, which @vscode/test-cli hands on to VS Code
// and so to the tests in its extension host. No imports, so both Node (the
// config) and the tests' esbuild bundle can load it.
export const INTEGRATION_FIXTURE_ENV = "AI_CREDITS_ANALYZER_INTEGRATION_FIXTURE";

export interface IntegrationFixture {
  // The --user-data-dir VS Code runs with.
  userDataDir: string;
  // The session with a debug log: real token and AI Credits numbers.
  usageSessionId: string;
  usageSessionTitle: string;
  sessionCount: number;
}

function invalid(reason: string): Error {
  return new Error(`Invalid integration fixture in ${INTEGRATION_FIXTURE_ENV}: ${reason}`);
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

// The fixture from the variable's value; throws with what's wrong, so a
// suite started some other way fails with a clear message.
export function parseIntegrationFixture(raw: string | undefined): IntegrationFixture {
  if (raw === undefined || raw === "") {
    throw new Error(
      `${INTEGRATION_FIXTURE_ENV} is not set: run the suite with \`npm run test:integration\`, which seeds the integration fixture`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw invalid("not JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid("not an object");
  }
  const { userDataDir, usageSessionId, usageSessionTitle, sessionCount } = value as Record<string, unknown>;
  if (typeof userDataDir !== "string" || !isAbsolutePath(userDataDir)) {
    throw invalid("userDataDir must be an absolute path");
  }
  if (typeof usageSessionId !== "string" || usageSessionId === "" || typeof usageSessionTitle !== "string") {
    throw invalid("usageSessionId and usageSessionTitle must be strings");
  }
  if (typeof sessionCount !== "number" || !Number.isInteger(sessionCount) || sessionCount < 1) {
    throw invalid("sessionCount must be a positive integer");
  }
  return { userDataDir, usageSessionId, usageSessionTitle, sessionCount };
}
