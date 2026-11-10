// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CostVarianceViewModel, NotExplainedView } from "../../view-models/index.js";
import "./cost-change.css";

// Turns with no priced figure, per period, with the server's reasons. The
// reasons are logged text (model names, dates): shown here, never sent to
// the host's model (§6). They are read from displayOnly only.

function Period({ label, entry }: { label: string; entry: NotExplainedView }) {
  return (
    <div>
      <b>{`${label}: ${entry.turnsText}`}</b>
      {entry.displayOnly.reasons.length > 0 && (
        <ul className="cv-reasons">
          {entry.displayOnly.reasons.map((reason, index) => (
            <li key={`${index}:${reason}`}>{reason}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NotExplained({ vm }: { vm: CostVarianceViewModel }) {
  const total = vm.notExplained.periodA.turns + vm.notExplained.periodB.turns;
  return (
    <section className="view-section" aria-label="Not explained">
      <div className="view-section-head">
        <h2>Not explained</h2>
        <span className="text-muted">{total === 0 ? "every turn has a priced figure" : `${total} ${total === 1 ? "turn" : "turns"} in all`}</span>
      </div>
      {vm.hasNotExplained && <p className="cv-note text-muted">These turns have no priced figure, so no effect is attributed to them. They are left out of every number above, not counted as 0.</p>}
      <div className="cv-two">
        <Period label={vm.periodA.label} entry={vm.notExplained.periodA} />
        <Period label={vm.periodB.label} entry={vm.notExplained.periodB} />
      </div>
    </section>
  );
}
