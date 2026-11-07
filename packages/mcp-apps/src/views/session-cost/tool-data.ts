import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionCost, TurnSeries, TurnView } from "@agent-cost-analyzer/domain";
import type { AppHostPort } from "../../host/app-host-port.js";

// Reading the tool results the view works from. The server validates every
// result against its schema, so the view only checks the shape it relies on
// (the zod schemas stay out of the bundle).

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseSessionCost(value: unknown): SessionCost | undefined {
  if (!isRecord(value) || typeof value.sessionId !== "string") return undefined;
  if (!Array.isArray(value.topTurns) || !isRecord(value.totals) || !isRecord(value.contextOverhead)) return undefined;
  return value as unknown as SessionCost;
}

export function parseTurnSeries(value: unknown): TurnSeries | undefined {
  if (!isRecord(value) || typeof value.sessionId !== "string" || !Array.isArray(value.turns)) return undefined;
  return value as unknown as TurnSeries;
}

export function parseTurnView(value: unknown): TurnView | undefined {
  if (!isRecord(value) || typeof value.turnIndex !== "number" || !isRecord(value.usage) || !Array.isArray(value.toolCalls)) return undefined;
  return value as unknown as TurnView;
}

// A drill-down call: undefined for a tool error or an unreadable result.
// A rejected call is caught by the hook below.
export async function callParsed<T>(port: AppHostPort, name: string, args: Record<string, unknown>, parse: (value: unknown) => T | undefined): Promise<T | undefined> {
  const result = await port.callTool(name, args);
  if (result.isError) return undefined;
  return parse(result.structuredContent);
}

export type Resource<T> = { status: "idle" } | { status: "loading" } | { status: "ready"; data: T } | { status: "error" };

// Loads on mount (auto) or on demand (load()), and again on retry. A new
// `key` starts over; a late answer from an old load is dropped.
export function useResource<T>(fetcher: () => Promise<T | undefined>, auto: boolean, key: string): { state: Resource<T>; load: () => void } {
  const [state, setState] = useState<Resource<T>>(auto ? { status: "loading" } : { status: "idle" });
  const latest = useRef(fetcher);
  latest.current = fetcher;
  const generation = useRef(0);

  const load = useCallback(() => {
    const mine = ++generation.current;
    setState({ status: "loading" });
    latest
      .current()
      .then((data) => (data === undefined ? ({ status: "error" } as const) : ({ status: "ready", data } as const)))
      .catch(() => ({ status: "error" }) as const)
      .then((next) => {
        if (generation.current === mine) setState(next);
      });
  }, []);

  useEffect(() => {
    if (auto) load();
    return () => {
      generation.current += 1;
    };
  }, [auto, key, load]);

  return { state, load };
}
