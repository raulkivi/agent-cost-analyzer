// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { Tag } from "@agent-cost-analyzer/web/ui/Tag";
import type { ChangeDirection, DocumentedChangeView, ObservedChangeView } from "../../view-models/index.js";
import "./price-changes.css";

// One change in U13's list. A documented change comes from the price book:
// % per token type and its sources. An observed one is inferred from billed
// against priced figures: the "inferred" tag, a dashed rail and a weekly
// table. A rise is written in the host's danger colour and a fall in its
// success colour, always with the sign as well, for inferred changes too
// (§9.2 Q11). Every string here is price-book or logged text, shown as text.

const CLASS: Record<ChangeDirection, string> = { rise: "pc-rise", fall: "pc-fall", flat: "pc-flat", unknown: "pc-flat" };

// No percentage when a side has no price: said, never shown as 0 or as a rise.
function missingPercent(fromText: string, toText: string): string {
  if (fromText === "none" && toText === "none") return "no price";
  return fromText === "none" ? "no earlier price" : "no later price";
}

function DiamondMark({ inferred }: { inferred: boolean }) {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" className={inferred ? "pc-mark pc-mark-inferred" : "pc-mark"}>
      <polygon points="6,1 10.5,6 6,11 1.5,6" />
    </svg>
  );
}

function Frame({ inferred, dateText, children }: { inferred: boolean; dateText: string; children: React.ReactNode }) {
  return (
    <li className={inferred ? "pc-entry pc-entry-inferred" : "pc-entry"} data-kind={inferred ? "observed" : "documented"}>
      <span className="pc-date">{dateText}</span>
      <span className={inferred ? "pc-rail pc-rail-inferred" : "pc-rail"}>
        <DiamondMark inferred={inferred} />
      </span>
      <div className="pc-body">{children}</div>
    </li>
  );
}

export function DocumentedEntry({ change }: { change: DocumentedChangeView }) {
  return (
    <Frame inferred={false} dateText={change.dateText}>
      <h3 className="pc-name">
        <span className="pc-model">{change.modelId}</span>
        <Tag variant="outline">{change.channel}</Tag>
        <Tag variant="neutral" className="view-estimate" title="Taken from the price book, with sources">
          documented
        </Tag>
      </h3>
      <dl className="pc-lines" aria-label={`${change.modelId} price per 1M tokens`}>
        {change.lines.map((line) => (
          <div key={line.tokenText} className="pc-line">
            <dt className="text-muted">{line.tokenText}</dt>
            <dd className="pc-prices">{`${line.fromText} → ${line.toText}`}</dd>
            <dd className={`pc-percent ${CLASS[line.direction]}`}>{line.percentText ?? <span className="text-muted">{missingPercent(line.fromText, line.toText)}</span>}</dd>
          </div>
        ))}
      </dl>
      <p className="pc-source text-muted">
        {change.sourceIds.length === 0 ? "No source recorded." : `Source${change.sourceIds.length === 1 ? "" : "s"}: ${change.sourceIds.join(", ")}.`}
        {change.note === undefined ? "" : ` ${change.note}`}
      </p>
    </Frame>
  );
}

export function ObservedEntry({ change, note }: { change: ObservedChangeView; note: string }) {
  const direction: ChangeDirection = change.direction === "above" ? "rise" : "fall";
  return (
    <Frame inferred dateText={change.dateText}>
      <h3 className="pc-name">
        <span className="pc-model">{change.modelId}</span>
        <Tag variant="outline">{change.channel}</Tag>
        <Tag variant="outline" className="view-estimate" title="Inferred from billed against priced figures, not documented in the price book">
          {change.label}
        </Tag>
      </h3>
      <p className="pc-observed">
        {"Billed "}
        <b className={CLASS[direction]}>{change.percentText}</b>
        {` ${change.direction} the price book, ${change.weeksText}.`}
      </p>
      <div className="view-scroll" tabIndex={0} role="region" aria-label={`${change.modelId} weekly billed against priced, scrollable`}>
        <table className="view-table pc-weeks" aria-label={`${change.modelId} weekly billed against priced`}>
          <caption className="pc-caption text-muted">Weekly billed vs priced, AI Credits, turns with both figures</caption>
          <thead>
            <tr>
              <th className="view-left">Week</th>
              <th>Turns</th>
              <th>Billed</th>
              <th>Priced</th>
              <th>Ratio</th>
            </tr>
          </thead>
          <tbody>
            {change.weeks.map((week) => (
              <tr key={week.period}>
                <td className="view-left">{week.period}</td>
                <td>{week.turnsText}</td>
                <td>{week.billedText}</td>
                <td>{week.pricedText}</td>
                <td>{week.ratioText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pc-source text-muted">{`${note} Seen in the logs; the vendor has not documented it.`}</p>
    </Frame>
  );
}
