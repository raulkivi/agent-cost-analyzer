// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useId } from "react";
import type { MeasuredCost, SessionReplay, Turn } from "@agent-cost-analyzer/domain";
import { currencyLabel, formatReplayAmount, formatSimulatedCost, UNKNOWN } from "../../lib/replay-format.js";
import { CacheOutcomeBadge } from "../learn/CacheOutcomeBadge.js";
import { notReplayedReason } from "../TurnsTable.js";
import { SimulatedBadge } from "./SimulatedBadge.js";

interface ReplayTurnNoteProps {
  // The selected turn, for its measured cache write.
  turn: Turn;
  replay: SessionReplay;
}

const tokens = (value: number | null): string => (value === null ? UNKNOWN : value.toLocaleString());
const measuredCost = (cost: MeasuredCost): string => (cost.known ? formatReplayAmount(cost.value, cost.currency) : UNKNOWN);

// Mock-up board 1's right column: the selected turn on the replay model, in
// a dashed box under its explanation. Only what the data says: the outcome
// word and the figures, measured beside simulated, or why it wasn't replayed.
export function ReplayTurnNote({ turn, replay }: ReplayTurnNoteProps) {
  const headingId = useId();
  const replayTurn = replay.turns.find((candidate) => candidate.turnIndex === turn.index);
  const simulated = replayTurn?.simulated ?? null;
  const measuredWrite = turn.usage.cacheWrite.known ? turn.usage.cacheWrite.value : null;
  return (
    <section className="sim-frame replay-turn-note" aria-labelledby={headingId}>
      <h4 id={headingId} className="replay-total-head">
        <SimulatedBadge />{" "}
        <span className="card-kicker">on {replay.model}</span>
      </h4>
      {simulated === null || !replayTurn ? (
        <p className="replay-turn-note-text">Not replayed: {notReplayedReason(replayTurn)}</p>
      ) : (
        <>
          <p className="replay-turn-note-text">
            <CacheOutcomeBadge outcome={simulated.outcome} showWord />
          </p>
          <table className="replay-turn-note-table">
            <thead>
              <tr>
                <td />
                <th scope="col">Measured</th>
                <th scope="col">Simulated</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Cache read</th>
                <td>{tokens(replayTurn.measured.cacheRead)}</td>
                <td>{simulated.cacheRead.toLocaleString()}</td>
              </tr>
              <tr>
                <th scope="row">Cache write</th>
                <td>{tokens(measuredWrite)}</td>
                <td>{simulated.cacheWrite.toLocaleString()}</td>
              </tr>
              <tr>
                <th scope="row">Cost, {currencyLabel(replay.currency)}</th>
                <td>{measuredCost(replayTurn.measured.cost)}</td>
                <td>{formatSimulatedCost(simulated.cost)}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
