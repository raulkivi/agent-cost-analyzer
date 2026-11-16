// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { SegmentedControl } from "@agent-cost-analyzer/web/ui/SegmentedControl";
import type { AgentScope, AuditRunRow, SubagentsSection } from "../../view-models/index.js";
import "./audit.css";

// Step 10.20, ST13 (boards U4AuditView.dc.html): the subagent parts of U4.
// Run labels, depths and reasons are logged text, rendered as text nodes
// only and never sent to the host's model (§6). The filter changes what the
// view shows; it calls no tool.

export function AgentFilter({ scopes, onScope }: { scopes: SubagentsSection["scopes"]; onScope: (scope: AgentScope) => void }) {
  return (
    <div className="au-filter">
      <SegmentedControl
        name="audit-agent"
        label="Agent"
        options={scopes.map(({ value, label }) => ({ value, label }))}
        value={scopes.find((scope) => scope.selected)?.value ?? "all"}
        onChange={onScope}
      />
    </div>
  );
}

// The share is written next to each bar, so no figure depends on bar length
// or color; the subagent bar is hatched, not only a second color.
export function CallsByAgent({ split }: { split: SubagentsSection["split"] }) {
  const rows = [
    { part: split.main, hatched: false },
    { part: split.subagents, hatched: true },
  ];
  return (
    <section className="view-section" aria-label="Calls by agent">
      <div className="view-section-head">
        <h2>Calls by agent</h2>
      </div>
      <ul className="au-bars au-split">
        {rows.map(({ part, hatched }) => (
          <li key={part.label} className="au-bar-row au-split-row">
            <span className="au-bar-label">{part.label}</span>
            <span className="au-bar-track">
              <span data-bar="" className={hatched ? "au-bar-fill au-bar-hatched" : "au-bar-fill"} style={{ width: `${Math.max(1, part.fraction * 100)}%` }} />
            </span>
            <span className="au-bar-value">
              {part.callsText} <span className="text-muted">· {part.shareText}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RunItem({ run }: { run: AuditRunRow }) {
  return (
    <li className="au-run" data-unread={run.kind === "unread" ? "" : undefined} data-flagged={run.kind === "flagged" ? "" : undefined}>
      <div className="au-run-head">
        <b className="au-command">{run.label}</b>
        <span className="au-run-turn text-muted">{run.turnText}</span>
      </div>
      {run.matchedByTime === true && <span className="au-pill">matched by time</span>}
      {run.depthText !== undefined && <div className="au-run-depth text-muted">{run.depthText}</div>}
      <div className={run.kind === "unread" ? "au-run-figs text-muted" : "au-run-figs"}>{run.figuresText}</div>
      {run.reason !== undefined && (
        <div className="au-run-reason text-muted">
          {run.kind === "flagged" && <span className="au-flag">flagged: </span>}
          {run.reason}
        </div>
      )}
    </li>
  );
}

export function SubagentRuns({ subagents }: { subagents: SubagentsSection }) {
  if (subagents.runs.length === 0) return null;
  return (
    <section className="view-section" aria-label="Subagent runs">
      <div className="view-section-head">
        <h2>Subagent runs</h2>
        <span className="text-muted">run label, turn, then calls · failed · unknown · rate</span>
      </div>
      {subagents.unreadNote !== undefined && <p className="au-unread-note">{subagents.unreadNote}</p>}
      <ul className="au-runs" aria-label="Subagent runs">
        {subagents.runs.map((run) => (
          <RunItem key={run.key} run={run} />
        ))}
      </ul>
    </section>
  );
}
