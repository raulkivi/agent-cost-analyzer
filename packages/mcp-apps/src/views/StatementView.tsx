// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { StatTile } from "@agent-cost-analyzer/web/ui/StatTile";
import { useMemo } from "react";
import type { ViewBrand } from "../brand/view-brand.js";
import type { AppHostPort, ToolResult } from "../host/app-host-port.js";
import { toStatementViewModel } from "../view-models/index.js";
import type { StatementViewModel } from "../view-models/index.js";
import { NoViewState } from "./NoViewState.js";
import { withoutStop } from "./sentence.js";
import { ErrorBox } from "./SessionCostView.js";
import { ViewShell } from "./ViewShell.js";
import { CurrencyTable, UNIT, bare } from "./statement/CurrencyTable.js";
import { IssuedDiff } from "./statement/IssuedDiff.js";
import { parseStatementAnswer } from "./statement/parse-statement.js";
import "./statement/statement.css";

// U14, a project's statement for a period (plan §4.5, §9.2 Q13/Q14, board
// Increment3States.dc.html). Standalone only: the extension has no billing
// views, so in it this renders the neutral state and none of the result.
// Read-only: no issue, re-issue or export control, and no host call. Project,
// client and line labels are logged or configured text: displayed, never sent
// to the host's model (§6).

const KICKER = "Statement";

const CHECK_ICON = (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

function Tiles({ vm }: { vm: StatementViewModel }) {
  return (
    <div className="stat-tiles view-tiles">
      {vm.totals.map((total) => (
        <StatTile
          key={total.currency}
          label={`Total, ${UNIT[total.currency]}`}
          value={bare(total.totalText)}
          note={`lines ${bare(total.linesText)} + markup ${bare(total.markupText)} + fixed ${bare(total.fixedText)}${vm.coverage.partial ? ` · ${vm.coverage.text}` : ""}`}
        />
      ))}
    </div>
  );
}

function Draft({ vm }: { vm: StatementViewModel }) {
  return (
    <div className="stm-alert stm-alert--info" role="status">
      <div>
        <b>Not issued.</b> A draft is built from the logs when asked and can change.{" "}
        {vm.canIssue.ok ? "It can be issued in the app." : `It can't be issued yet: ${withoutStop(vm.canIssue.reason ?? "the period is not complete")}.`}
      </div>
    </div>
  );
}

function Groups({ vm }: { vm: StatementViewModel }) {
  return (
    <>
      <section className="stm-section" aria-label="No known cost">
        <div className="stm-cur">
          <h2>No known cost</h2>
          <span className="text-muted">{vm.coverage.partial ? `counted, never 0 · ${vm.coverage.text}` : "counted, never 0"}</span>
        </div>
        {vm.unknown.length === 0 ? (
          <p className="stm-note text-muted">{vm.coverage.text}.</p>
        ) : (
          <ul className="stm-list">
            {vm.unknown.map((group, index) => (
              <li key={`${index}:${group.reason}`}>
                {`${group.turnsText} in ${group.sessionsText}: ${withoutStop(group.reason)}. Their cost is `}
                <i className="view-unknown">{group.amountText}</i>.
              </li>
            ))}
          </ul>
        )}
      </section>
      {vm.excluded.length > 0 && (
        <ul className="stm-list" aria-label="Left off">
          {vm.excluded.map((group, index) => (
            <li key={`${index}:${group.reason}`}>{`Left off: ${group.turnsText} in ${group.sessionsText}, ${withoutStop(group.reason)}.`}</li>
          ))}
        </ul>
      )}
    </>
  );
}

function StatementBody({ brand, result }: { brand: ViewBrand; result: ToolResult | undefined }) {
  const answer = useMemo(() => (result === undefined || result.isError ? undefined : parseStatementAnswer(result.structuredContent)), [result]);
  const vm = useMemo(() => (answer === undefined ? undefined : toStatementViewModel(answer)), [answer]);

  if (result === undefined) {
    return (
      <ViewShell brand={brand} kicker={KICKER} title="Statement">
        <p role="status" className="text-muted">
          Waiting for the statement…
        </p>
      </ViewShell>
    );
  }
  if (vm === undefined) {
    const reason = result.isError ? result.errorText?.trim() : undefined;
    return (
      <ViewShell brand={brand} kicker={KICKER} title="Statement">
        <ErrorBox title="Couldn't show the statement.">
          {reason ? `The tool returned an error: ${reason}` : "get_statement returned an error or a result this view can't read. The text answer above has the reason; check the project id and the period."}
        </ErrorBox>
      </ViewShell>
    );
  }

  const meta = [vm.client, vm.billingCode === undefined ? undefined : `billing code ${vm.billingCode}`].filter((part) => part !== undefined).join(" · ");
  return (
    <ViewShell
      brand={brand}
      kicker={KICKER}
      title={`${vm.title} · ${vm.periodText}`}
      meta={
        <span className="stm-status">
          {vm.status === "issued" && CHECK_ICON}
          {vm.statusText}
        </span>
      }
    >
      {meta !== "" && <p className="stm-note text-muted">{meta}</p>}
      {vm.status === "draft" && <Draft vm={vm} />}
      <Tiles vm={vm} />
      {vm.totals.map((total) => (
        <CurrencyTable key={total.currency} vm={vm} total={total} />
      ))}
      <Groups vm={vm} />
      {vm.diff !== undefined && <IssuedDiff diff={vm.diff} />}
      {vm.issuedPeriods.length > 0 && <p className="stm-note text-muted">{`Issued periods: ${vm.issuedPeriods.join(", ")}.`}</p>}
      <p className="stm-note text-muted">{`Statements are issued in the ${brand.displayName} app. This view cannot issue or change one. ${vm.conversionNote}`}</p>
    </ViewShell>
  );
}

export function StatementView({ brand, result }: { port: AppHostPort; brand: ViewBrand; result: ToolResult | undefined }) {
  if (brand.productId !== "standalone") return <NoViewState brand={brand} />;
  return <StatementBody brand={brand} result={result} />;
}
