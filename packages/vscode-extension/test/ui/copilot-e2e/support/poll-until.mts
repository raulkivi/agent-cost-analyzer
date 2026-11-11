// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Polls a reader until a predicate holds or a bounded time passes. For the
// real-Copilot specs: a session shows up before Copilot's debug log holds all
// its tool calls, so the audit is read until the call appears, not once.
// Pure: the reader, sleep and clock are injected (unit-tested, no real waits).

// Copilot logs a call within seconds; 90 s is generous and costs nothing once it appears.
export const AUDIT_POLL_INTERVAL_MS = 2_000;
export const AUDIT_POLL_LIMIT_MS = 90_000;

export interface PollOptions<T> {
  read: () => Promise<T>;
  isSatisfied: (value: T) => boolean;
  intervalMs: number;
  timeoutMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export interface PollResult<T> {
  value: T;
  satisfied: boolean;
}

// A reader error propagates at once: the tool call itself failed, which more
// waiting won't fix, and hiding it behind a 90 s retry would blur the cause.
export async function pollUntil<T>(options: PollOptions<T>): Promise<PollResult<T>> {
  const deadline = options.now() + options.timeoutMs;
  for (;;) {
    const value = await options.read();
    if (options.isSatisfied(value)) return { value, satisfied: true };
    const remaining = deadline - options.now();
    if (remaining <= 0) return { value, satisfied: false };
    await options.sleep(Math.min(options.intervalMs, remaining));
  }
}
