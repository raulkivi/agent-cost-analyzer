// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useMemo } from "react";
import type { ViewBrand } from "../brand/view-brand.js";
import type { ToolResult } from "../host/app-host-port.js";
import { toAuditRollupViewModel, toSessionAuditViewModel } from "../view-models/index.js";
import { ErrorBox } from "./SessionCostView.js";
import { ViewShell } from "./ViewShell.js";
import { AuditRollupBody } from "./audit/AuditRollupBody.js";
import { SessionAuditBody } from "./audit/SessionAuditBody.js";
import { parseAuditResult } from "./audit/parse-audit.js";
import "./audit/audit.css";

// U4, tool-call audit (plan §4.5, board ToolCallAudit.dc.html): renders
// get_session_audit (one session) or get_audit_rollup (a date range). It
// reads the result only. It calls no tool and sends no message, so nothing
// in it can reach the host's model (§6): commands, titles and tool names are
// logged text, shown as text.

const KICKER = "Tool-call audit";

export function AuditView({ brand, result }: { brand: ViewBrand; result: ToolResult | undefined }) {
  const parsed = useMemo(() => (result === undefined || result.isError ? undefined : parseAuditResult(result.structuredContent)), [result]);

  if (result === undefined) {
    return (
      <ViewShell brand={brand} kicker={KICKER} title="Tool-call audit">
        <p role="status" className="text-muted">
          Waiting for the tool-call audit…
        </p>
      </ViewShell>
    );
  }
  if (parsed === undefined) {
    return (
      <ViewShell brand={brand} kicker={KICKER} title="Tool-call audit">
        <ErrorBox title="Couldn't load the tool-call audit.">The tool returned an error or a result this view can't read. The text answer above is complete.</ErrorBox>
      </ViewShell>
    );
  }
  if (parsed.kind === "session") return <LoadedSessionAudit audit={parsed.audit} brand={brand} />;
  return <LoadedRollupAudit rollup={parsed.rollup} brand={brand} />;
}

function LoadedSessionAudit({ audit, brand }: { audit: Parameters<typeof toSessionAuditViewModel>[0]; brand: ViewBrand }) {
  const vm = useMemo(() => toSessionAuditViewModel(audit), [audit]);
  return (
    <ViewShell brand={brand} kicker={KICKER} title={vm.title} meta={vm.metaText}>
      <SessionAuditBody vm={vm} />
    </ViewShell>
  );
}

function LoadedRollupAudit({ rollup, brand }: { rollup: Parameters<typeof toAuditRollupViewModel>[0]; brand: ViewBrand }) {
  const vm = useMemo(() => toAuditRollupViewModel(rollup), [rollup]);
  const meta = [vm.periodText, vm.sessionsText].filter((part) => part !== undefined).join(" · ");
  return (
    <ViewShell brand={brand} kicker={KICKER} title="Tool-call failures" meta={meta}>
      <AuditRollupBody vm={vm} />
    </ViewShell>
  );
}
