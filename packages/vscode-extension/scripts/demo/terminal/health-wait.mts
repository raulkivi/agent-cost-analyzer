// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Clock, WaitOptions } from "../desktop/wait-for-match.mts";

export type HealthGet = (url: string) => Promise<{ ok: boolean }>;

// Polls GET /api/health until the CLI's server answers; a refused connection just means "not yet".
export async function waitForHealth(port: number, get: HealthGet, o: WaitOptions, clock: Clock): Promise<void> {
  const url = `http://127.0.0.1:${port}/api/health`;
  const deadline = clock.now() + o.timeoutMs;
  for (;;) {
    if (await get(url).then((r) => r.ok, () => false)) return;
    if (clock.now() + o.intervalMs > deadline) throw new Error(`${url} did not answer within ${o.timeoutMs} ms`);
    await clock.sleep(o.intervalMs);
  }
}
