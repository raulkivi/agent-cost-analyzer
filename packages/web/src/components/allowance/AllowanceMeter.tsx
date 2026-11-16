// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CSSProperties } from "react";
import type { AllowanceLevel } from "@agent-cost-analyzer/domain";
import type { AllowanceMeter as MeterModel } from "../../lib/allowance/allowance-view.js";

interface AllowanceMeterProps {
  meter: MeterModel;
  level: AllowanceLevel;
  // The details dialog's full-width meter, with its 0, warn and 100 % scale.
  large?: boolean;
}

// The ruler of Header.dc.html. Decorative: every level is in the words beside
// it, so it is aria-hidden. An "at least" total ends in a hatched, dashed
// open end (never drawn exact); "over" is full with a cap past the end; a
// tick marks the warn percentage.
export function AllowanceMeter({ meter, level, large = false }: AllowanceMeterProps) {
  const style = { "--p": meter.fillPercent, "--w": meter.warnAtPercent } as CSSProperties;
  return (
    <>
      <span className={`allowance-meter allowance-meter--${level}${large ? " allowance-meter--large" : ""}`} aria-hidden="true" style={style}>
        <i className="allowance-meter-fill" />
        {meter.openEnded && <i className="allowance-meter-open" />}
        <i className="allowance-meter-tick" />
        {meter.overflow && <i className="allowance-meter-cap" />}
      </span>
      {large && (
        <div className="allowance-scale" aria-hidden="true">
          <span style={{ left: 0 }}>0</span>
          <span style={{ left: `${meter.warnAtPercent}%` }}>{meter.warnAtPercent} %</span>
          <span style={{ left: "100%" }}>100 %</span>
        </div>
      )}
    </>
  );
}
