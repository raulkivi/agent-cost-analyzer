// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useState } from "react";
import type { SessionReplay } from "@agent-cost-analyzer/domain";
import type { ReplayPricingRequest } from "../api-client/replay.js";
import { replayUnavailableReason } from "../lib/replay-models.js";
import { useSessionReplay, type ReplayLoader, type SessionReplayLoad } from "./use-session-replay.js";

// Phase 14 step 14.7: the open Analyze session's replay as the App shows it
// (plan §3): the Replay on model, the price channel shared by the strip, the
// summary panel and Compare models, and which of those is open. All of it is
// per session: another session starts at Off, on its own channel.

export interface AnalyzeReplaySession {
  id: string;
  providerId?: string;
}

interface ReplayViewState {
  model: string | null;
  pricing: ReplayPricingRequest;
  summaryOpen: boolean;
  compareOpen: boolean;
}

const INITIAL: ReplayViewState = { model: null, pricing: "session-channel", summaryOpen: false, compareOpen: false };

export interface AnalyzeReplay extends ReplayViewState {
  load: SessionReplayLoad;
  // The ready replay, if any.
  replay?: SessionReplay;
  // Why this session can't be replayed (D1), if it can't.
  unavailableReason?: string;
  setModel(model: string | null): void;
  setPricing(pricing: ReplayPricingRequest): void;
  setSummaryOpen(open: boolean): void;
  setCompareOpen(open: boolean): void;
}

export function useAnalyzeReplay({
  session,
  enabled,
  load,
}: {
  session: AnalyzeReplaySession | null;
  // features.sessionReplay, in Analyze mode.
  enabled: boolean;
  load?: ReplayLoader;
}): AnalyzeReplay {
  const key = session ? JSON.stringify([session.providerId ?? null, session.id]) : null;
  const [stored, setStored] = useState<{ key: string | null; view: ReplayViewState }>({ key, view: INITIAL });
  // A stored view for another session is that session's: this one starts over.
  const view = stored.key === key ? stored.view : INITIAL;
  const update = (patch: Partial<ReplayViewState>) =>
    setStored((previous) => ({ key, view: { ...(previous.key === key ? previous.view : INITIAL), ...patch } }));

  const unavailableReason = session ? replayUnavailableReason(session.providerId) : undefined;
  const active = enabled && session !== null && unavailableReason === undefined;
  const replayLoad = useSessionReplay({
    sessionId: session?.id ?? "",
    ...(session?.providerId ? { providerId: session.providerId } : {}),
    model: active ? view.model : null,
    pricing: view.pricing,
    ...(load ? { load } : {}),
  });

  return {
    ...view,
    load: replayLoad,
    ...(replayLoad.replay ? { replay: replayLoad.replay } : {}),
    ...(unavailableReason ? { unavailableReason } : {}),
    setModel: (model) => update({ model }),
    setPricing: (pricing) => update({ pricing }),
    setSummaryOpen: (summaryOpen) => update({ summaryOpen }),
    setCompareOpen: (compareOpen) => update({ compareOpen }),
  };
}
