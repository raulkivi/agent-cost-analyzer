// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// D4 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/npm-package.md §4.4): one fixed default, so the browser origin (and
// with it the theme choice and other browser storage) stays the same between
// runs.
export const DEFAULT_PORT = 5199;
const FALLBACK_PORTS = 10;

export type ListenOutcome<S> = { status: "listening"; port: number; server: S } | { status: "busy" };

// The two questions the choice asks of the machine, injected so the rules
// run without sockets.
export interface PortProbes<S> {
  /** Tries to bind 127.0.0.1:port; 0 means any free port. Busy is not an error. */
  listen(port: number): Promise<ListenOutcome<S>>;
  /** True when the port answers GET /api/health as this app. */
  isThisApp(port: number): Promise<boolean>;
}

export type PortChoice<S> =
  | { kind: "bound"; port: number; server: S; fellBack: boolean }
  | { kind: "running"; port: number }
  | { kind: "unavailable"; message: string };

/** `--port` skips the fallbacks: exactly that port, 0 included. */
export function portCandidates(requested: number | undefined): number[] {
  if (requested !== undefined) return [requested];
  return Array.from({ length: FALLBACK_PORTS + 1 }, (_, i) => DEFAULT_PORT + i);
}

/**
 * Binds the first free candidate. A busy default port holding this app is
 * reused (also on a later candidate, where an earlier fallback left it); one
 * held by anything else is skipped. Binding is the test for "free", so no
 * port is picked and then lost to a race.
 */
export async function choosePort<S>(requested: number | undefined, probes: PortProbes<S>): Promise<PortChoice<S>> {
  const candidates = portCandidates(requested);
  for (const [index, candidate] of candidates.entries()) {
    const outcome = await probes.listen(candidate);
    if (outcome.status === "listening") return { kind: "bound", port: outcome.port, server: outcome.server, fellBack: index > 0 };
    if (requested === undefined && (await probes.isThisApp(candidate))) return { kind: "running", port: candidate };
  }
  if (requested !== undefined) {
    return { kind: "unavailable", message: `Port ${requested} is already in use. Choose another with --port, or use --port 0 for any free port.` };
  }
  const last = candidates[candidates.length - 1];
  return { kind: "unavailable", message: `Ports ${DEFAULT_PORT} to ${last} are all in use. Free one, or choose with --port (--port 0 takes any free port).` };
}
