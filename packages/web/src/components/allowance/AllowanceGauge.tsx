// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Ref } from "react";
import type { AllowanceView } from "../../lib/allowance/allowance-view.js";
import { AllowanceMeter } from "./AllowanceMeter.js";

interface AllowanceGaugeProps {
  view: AllowanceView;
  // The narrow layout (§4.7): the figure, then the meter with the short level
  // word ("near", "over") under it. The full "near limit" stays in the details
  // and the aria-label.
  narrow: boolean;
  onOpen: () => void;
  ref?: Ref<HTMLButtonElement>;
}

// The header button of Header.dc.html: figure first, level last, in words.
// Color and the meter only add to the words. Not set is a muted prompt that
// opens the settings dialog; every other state opens the details.
export function AllowanceGauge({ view, narrow, onOpen, ref }: AllowanceGaugeProps) {
  const notSet = view.state === "not-set";
  const meter = view.meter ? <AllowanceMeter meter={view.meter} level={view.level} /> : null;
  const stacked = narrow && view.meter !== undefined;
  return (
    <button
      ref={ref}
      type="button"
      className={`btn btn-secondary allowance-gauge${notSet ? " allowance-gauge--unset" : ""}${narrow ? " allowance-gauge--narrow" : ""}`}
      aria-haspopup="dialog"
      // Not set has no label of its own: the visible text is the name.
      aria-label={notSet ? undefined : view.ariaLabel}
      onClick={onOpen}
    >
      {stacked ? (
        <>
          <span className="allowance-gauge-text">{view.figureText}</span>
          <span className="allowance-gauge-meter-row">
            {meter}
            {view.shortLevelWord !== undefined && <b>{view.shortLevelWord}</b>}
          </span>
        </>
      ) : (
        <>
          <span className="allowance-gauge-text">
            {view.levelWord !== undefined ? (
              <>
                {view.figureText} · <b>{view.levelWord}</b>
              </>
            ) : (
              view.headerText
            )}
          </span>
          {meter}
        </>
      )}
    </button>
  );
}
