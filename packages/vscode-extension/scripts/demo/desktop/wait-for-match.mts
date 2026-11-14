// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Match } from "./click-point.mts";

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}
export interface WaitOptions {
  timeoutMs: number;
  intervalMs: number;
}
type Probe = () => Promise<Match | undefined>;

// Polls until the template shows. The name only feeds the error, so a timeout says what never appeared.
export async function waitForMatch(name: string, probe: Probe, o: WaitOptions, clock: Clock): Promise<Match> {
  const deadline = clock.now() + o.timeoutMs;
  for (;;) {
    const match = await probe();
    if (match) return match;
    if (clock.now() + o.intervalMs > deadline) throw new Error(`Template "${name}" did not appear within ${o.timeoutMs} ms`);
    await clock.sleep(o.intervalMs);
  }
}

// Gone means absent on two probes in a row, so one frame between two states does not end the wait early.
export async function waitForGone(name: string, probe: Probe, o: WaitOptions, clock: Clock): Promise<void> {
  const deadline = clock.now() + o.timeoutMs;
  let absent = 0;
  for (;;) {
    absent = (await probe()) ? 0 : absent + 1;
    if (absent >= 2) return;
    if (clock.now() + o.intervalMs > deadline) throw new Error(`Template "${name}" was still on screen after ${o.timeoutMs} ms`);
    await clock.sleep(o.intervalMs);
  }
}
