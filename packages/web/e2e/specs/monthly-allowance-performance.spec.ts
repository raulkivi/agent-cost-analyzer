// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { expect, test } from "../support/app-fixture.js";

// MS5 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/monthly-allowance-standalone.md §10, 1.0 criterion C9): GET
// /api/monthly-allowance on the fixture home, with the allowance set, reads
// the real Copilot logs and answers within a sane bound. The 50 ms budget is
// for the computation alone (the service's performance test); this bound
// includes the log read, so it is generous and only catches a regression to
// something slow (such as a read per session).
const GET_BOUND_MS = 2_000;

test("MS5: GET /api/monthly-allowance on the fixture home answers within a sane bound", async ({ request, app }) => {
  const saved = await request.put(`${app.baseURL}/api/config/monthly-allowance`, { data: { aiCredits: 1000, resetDay: 1, warnAtPercent: 80 } });
  expect(saved.status()).toBe(200);

  const runs: number[] = [];
  let body: { state?: string } = {};
  for (let attempt = 0; attempt < 3; attempt++) {
    const start = performance.now();
    const response = await request.get(`${app.baseURL}/api/monthly-allowance`);
    runs.push(performance.now() - start);
    expect(response.status()).toBe(200);
    body = (await response.json()) as { state?: string };
  }
  const elapsed = Math.min(...runs);

  // The fixture's Copilot sessions (2026-10-27 and 28) fall before the period
  // of the fixed clock (2026-11-06), so the state is not what this checks.
  expect(["known", "unknown", "no-sessions"]).toContain(body.state);
  console.info(`GET /api/monthly-allowance on the fixture home: ${elapsed.toFixed(0)} ms (bound ${GET_BOUND_MS} ms; runs ${runs.map((run) => run.toFixed(0)).join(", ")})`);
  expect(elapsed).toBeLessThan(GET_BOUND_MS);
});
