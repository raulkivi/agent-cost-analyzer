// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionReplay } from "@agent-cost-analyzer/domain";
import { isAbortError } from "../api-client/abort.js";
import { ApiRequestError, apiErrorDetail } from "../api-client/api-request-error.js";
import { fetchSessionReplay, type ReplayPricingRequest, type SessionReplayQuery } from "../api-client/replay.js";

// Phase 14 step 14.7: the open Analyze session replayed on the chosen model
// (plan §3), as useCancellableLoad does its loads: a superseded request is
// aborted and its late answer ignored; cancel() aborts and goes back to idle.

// Mock-up board 4b: the skeleton shows only after this long.
export const REPLAY_LOADING_DELAY_MS = 300;

export type ReplayLoader = (sessionId: string, query: SessionReplayQuery, signal: AbortSignal) => Promise<SessionReplay>;

export interface UseSessionReplayArgs {
  sessionId: string;
  providerId?: string;
  // null: replay off, measured figures only.
  model: string | null;
  pricing: ReplayPricingRequest;
  // The API client by default; tests pass a fake (DIP).
  load?: ReplayLoader;
}

type ReplayState =
  | { status: "idle" }
  | { status: "loading"; key: string }
  // The person pressed Cancel: back to measured only, until an input changes.
  | { status: "cancelled"; key: string }
  | { status: "ready"; key: string; replay: SessionReplay }
  // `error` is the API's own words when it gave some (a 404's reason, a 400's
  // message), with its status; otherwise the transport's message.
  | { status: "error"; key: string; error: string; errorStatus?: number };

export interface SessionReplayLoad {
  status: "idle" | "loading" | "ready" | "error";
  replay?: SessionReplay;
  error?: string;
  errorStatus?: number;
  // True once a load has taken REPLAY_LOADING_DELAY_MS.
  showLoading: boolean;
  cancel(): void;
  retry(): void;
}

function queryFor({ providerId, model, pricing }: UseSessionReplayArgs & { model: string }): SessionReplayQuery {
  return {
    model,
    // The session's own channel is the API's default (D2).
    ...(pricing === "session-channel" ? {} : { pricing }),
    ...(providerId ? { provider: providerId } : {}),
  };
}

export function useSessionReplay(args: UseSessionReplayArgs): SessionReplayLoad {
  const { sessionId, providerId, model, pricing, load = fetchSessionReplay } = args;
  const [state, setState] = useState<ReplayState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const [delayPassed, setDelayPassed] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const key = model === null ? null : JSON.stringify([sessionId, providerId ?? null, model, pricing, attempt]);

  useEffect(() => {
    setDelayPassed(false);
    if (model === null || key === null) {
      setState({ status: "idle" });
      return;
    }
    const own = new AbortController();
    controller.current = own;
    setState({ status: "loading", key });
    const timer = setTimeout(() => setDelayPassed(true), REPLAY_LOADING_DELAY_MS);
    load(sessionId, queryFor({ sessionId, providerId, model, pricing }), own.signal)
      .then((replay) => {
        if (!own.signal.aborted) setState({ status: "ready", key, replay });
      })
      .catch((error: unknown) => {
        if (own.signal.aborted || isAbortError(error)) return;
        setState({
          status: "error",
          key,
          error: apiErrorDetail(error),
          ...(error instanceof ApiRequestError && error.status !== undefined ? { errorStatus: error.status } : {}),
        });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      own.abort();
    };
    // `key` covers every input; `load` is a stable function in practice.
  }, [key]);

  const cancel = useCallback(() => {
    controller.current?.abort();
    setState((previous) => (previous.status === "idle" ? previous : { status: "cancelled", key: previous.key }));
  }, []);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  // Until the effect has run for new inputs, the state still describes the
  // old ones: report loading rather than a stale replay.
  const matching: ReplayState = key === null ? { status: "idle" } : state.status !== "idle" && state.key === key ? state : { status: "loading", key };
  const current: ReplayState = matching.status === "cancelled" ? { status: "idle" } : matching;

  return {
    status: current.status as SessionReplayLoad["status"],
    ...(current.status === "ready" ? { replay: current.replay } : {}),
    ...(current.status === "error" ? { error: current.error, ...(current.errorStatus !== undefined ? { errorStatus: current.errorStatus } : {}) } : {}),
    showLoading: current.status === "loading" && delayPassed,
    cancel,
    retry,
  };
}
