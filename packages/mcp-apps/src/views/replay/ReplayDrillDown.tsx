// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useMemo, useRef } from "react";
import type { SessionReplay } from "@agent-cost-analyzer/domain";
import type { ViewBrand } from "../../brand/view-brand.js";
import type { AppHostPort } from "../../host/app-host-port.js";
import { toReplayViewModel } from "../../view-models/index.js";
import { ErrorBox } from "../SessionCostView.js";
import { ViewShell } from "../ViewShell.js";
import { BackButton } from "../cost-rollup/DrillDown.js";
import { useResource } from "../session-cost/tool-data.js";
import { ReplayDetail } from "./ReplayDetail.js";
import { isPlainModelId } from "./model-id.js";
import { parseSessionReplay } from "./parse-replay.js";
import "./replay.css";

// U12's compare mode to replay mode in place (plan §4.5): replay_session
// through the port, the tool the model can already call, with the session id,
// the provider and the model taken from the comparison result. The comparison
// stays in the parent, so going back refetches nothing. Never a chat message.

export interface ReplayTarget {
  sessionId: string;
  providerId: string;
  model: string;
}

const KICKER = "Replay on other models › Session replay";
const BACK_LABEL = "Back to model comparison";

// Where the drill-down came from: U12's comparison by default, U18 names itself.
export interface ReplayOrigin {
  kicker: string;
  backLabel: string;
  trail: string[];
  parent: string;
}

export function ReplayDrillDown({ port, brand, target, onBack, origin }: { port: AppHostPort; brand: ViewBrand; target: ReplayTarget; onBack: () => void; origin?: ReplayOrigin }) {
  const { sessionId, providerId, model } = target;
  // Why the last call failed: the tool's own text, shown as plain text.
  const failure = useRef<string | undefined>(undefined);
  const { state, load } = useResource<SessionReplay>(
    async () => {
      failure.current = undefined;
      if (!isPlainModelId(model)) return undefined;
      const answer = await port.callTool("replay_session", { sessionId, model, provider: providerId });
      if (answer.isError) {
        failure.current = answer.errorText;
        return undefined;
      }
      const found = parseSessionReplay(answer.structuredContent);
      // An answer for another session or model would show the wrong figures.
      return found?.sessionId === sessionId && found.model === model ? found : undefined;
    },
    true,
    `${providerId}:${sessionId}:${model}`,
  );
  const vm = useMemo(() => {
    if (state.status !== "ready") return undefined;
    const built = toReplayViewModel(state.data);
    return built.mode === "replay" ? built : undefined;
  }, [state]);
  const kicker = origin?.kicker ?? KICKER;
  const parent = origin?.parent ?? "the comparison";
  const lead = <BackButton onBack={onBack} label={origin?.backLabel ?? BACK_LABEL} trail={origin?.trail ?? ["Replay comparison", model]} />;

  if (vm !== undefined) return <ReplayDetail brand={brand} vm={vm} kicker={kicker} lead={lead} />;
  const reason = failure.current?.trim();
  return (
    <ViewShell brand={brand} kicker={kicker} title={`Replay on ${model}`} lead={lead}>
      {state.status === "error" ? (
        <ErrorBox title="Couldn't load this replay." onRetry={load}>
          {reason === undefined || reason === "" ? `The replay_session call failed. Go back to ${parent}, or retry.` : `The replay_session call failed: ${reason.slice(0, 500)}`}
        </ErrorBox>
      ) : (
        <p role="status" className="text-muted">
          Loading replay…
        </p>
      )}
    </ViewShell>
  );
}
