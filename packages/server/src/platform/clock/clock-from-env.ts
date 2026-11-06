// Phase 15 step 15.9 (docs/plans/cost-by-repository-and-project.md
// §12.4.1): the server's clock port. Unset, the real clock is used; the
// usage-scenario suite sets a fixed instant so relative ranges ("last 90
// days") and "today's prices" give the same figures on every run.
export const FIXED_NOW_ENV = "AGENT_COST_ANALYZER_NOW";

export function clockFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): (() => Date) | undefined {
  const value = env[FIXED_NOW_ENV];
  if (value === undefined || value === "") return undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time) || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    throw new Error(`${FIXED_NOW_ENV} must be an ISO timestamp such as 2026-11-06T12:00:00Z, not "${value}"`);
  }
  return () => new Date(time);
}
