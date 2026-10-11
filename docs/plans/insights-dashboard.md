# Insights dashboard: associative (QlikView-style) cost, tool-call and security analysis

Status: **in progress (Phase 9.11)**. §10 lists what shipped and the known
limitations.

## 1. Context

Analyze mode answers questions about one session at a time: the turns
table, the tool audit, and the turn inspector. The cross-session audit
(Phase 9.10) adds a fixed rollup of tool-call failures for one provider.
None of these views can answer open-ended questions across everything
that has been recorded, such as:

- *What is driving my spend this month: which models, which sessions,
  which days, cache misses or output?*
- *Did the agent do anything risky or suspicious, when, in which
  session, and why does it count as suspicious?*
- *Did the agent's behaviour change: new programs, new tools, new
  models, outlier sessions?*

The user asked for a **QlikView-like dashboard** focused on **cost & tokens**,
**tool calls & failures**, and **security: suspicious patterns,
anomalies, behaviour changes, answering what happened, when and why**. It
should cover **all log providers at once** and appear as a new full-width
**Dashboard** center view in Analyze mode. Those decisions are recorded in
§9.

## 2. What "QlikView-like" means here

QlikView's key idea is the **associative model**. Every field is a list
box, and you can click any value in any list box or chart. All other list
boxes then colour their values:

| State | Colour | Meaning |
|---|---|---|
| selected | green | the user selected it |
| possible | white | associated with the current selections |
| alternative | light grey | a different value in a field that already has a selection, which would still be possible if that field's selection were changed |
| excluded | dark grey | not associated with the current selections |

KPIs and charts always recalculate over the *possible* rows. A **Current
selections** bar lists every active selection. Each one can be cleared
on its own, all can be cleared at once, and **Back** undoes the last
selection change. Charts are selection surfaces too: clicking a bar
selects that value.

Seeing the grey (excluded) values is the point. *"Which models never
had a failure?"* or *"which providers have no findings?"* can be read
straight off the list boxes.

## 3. Data model

The server sends a small **star schema** of four flat tables, already
normalized and redacted. The browser runs the associative engine over
them. All selection logic runs client-side, so selections are instant
and never call the server (constraint 3: the UI only consumes the
normalized shape).

```
sessions (root)  key = providerId:sessionId
 ├── turns        parent = sessionKey      grain: one turn
 │    └── toolCalls parent = turnKey       grain: one tool call
 └── findings     parent = sessionKey      grain: one security/anomaly/behaviour finding
```

Findings link at **session** level, not turn level. Session-level
anomalies (for example a cost outlier) have no single turn to belong to,
and a tree with one parent per table keeps the engine simple and its
semantics easy to explain. Every finding still carries its `turnIndex`
and tool-call key where one exists, so the findings table shows exactly
where it happened.

Token figures are `number | null` per turn. `null` means *unknown*, never
`0` (constraint 6). Every measure reports its **coverage** ("AI Credits
12.34 · 40 of 52 turns known"), so a total over partly unknown data is
never presented as complete.

`packages/domain/src/insights.ts`:

```ts
insightSessionRowSchema  { key, providerId, providerLabel, sessionId, title, model, startedAt?, date?, hour? }
insightTurnRowSchema     { key, sessionKey, turnIndex, model, triggeredEvent?,
                           uncachedInput, cacheWrite, cacheRead, reasoning, output, aiCredits: number|null,
                           estimated: boolean, toolCallCount }
insightToolCallRowSchema { key, turnKey, name, kind, program?, status, failureCategory?, command?, startedAt?, durationMs? }
insightFindingSchema     { key, sessionKey, turnIndex?, toolCallKey?, kind: "security"|"anomaly"|"behavior-change",
                           category, severity: "info"|"low"|"medium"|"high"|"critical",
                           ruleId, title, at?, why, evidence? }
insightProviderStatusSchema { id, label, available, sessionCount, truncated, error? }
insightsDatasetSchema    { generatedAt, since?, until?, providers, sessions, turns, toolCalls, findings }
```

## 4. Server design (SOLID, all pure except the service)

```
LogProviderRegistry.listProviders()            (new: every registered provider)
        ▼
InsightsService (application service; depends on a narrow ProviderSource port: DIP)
  per provider: checkAvailability → listSessions → range filter + limit → readSession (sequential)
  a failing provider becomes { error } in providers[], the rest still load
        ▼
buildInsightsDataset(inputs)                   pure: Session[] → session/turn/toolCall rows
        ▼
FindingDetector[]                              strategy list (OCP), each pure: dataset → findings
  ├─ SecurityScanner(rules: SecurityRule[])    per tool call, ordered rule table
  ├─ AnomalyDetector                           robust z-score (median/MAD) on session metrics
  └─ BehaviorChangeDetector                    first use of a program/tool/model after a baseline
        ▼
GET /api/insights?since=&until=&limit=         limit is per provider (default 50, max 500)
```

### 4.1 Security rules

A `SecurityRule` is `{ id, category, severity, title, why, match(subject) }`.
`subject` is `{ kind, name, command?, paths[], status }`, built from the
normalized `ToolCallRecord`. The command text is already bounded and
redacted, and evidence goes through `excerptOf` again (≤200 chars). The
scanner records one finding per (call, rule). Each rule is an independent
strategy, so adding one is a new table entry and needs no edits elsewhere
(OCP).

| Rule id | Category | Severity | Matches |
|---|---|---|---|
| `shell.pipe-to-shell` | remote-code-execution | critical | `curl`/`wget` … `\|` `sh`/`bash`/`zsh`/`python` |
| `shell.decode-and-exec` | obfuscation | high | `base64 -d`/`--decode` piped to a shell, `eval "$(…)"` |
| `shell.rm-rf-root` | destructive-command | high | `rm -rf` on `/`, `~`, `$HOME`, `/*` |
| `shell.rm-rf` | destructive-command | medium | any other recursive force delete |
| `git.force-push` | history-rewrite | high | `git push --force`/`-f`/`--force-with-lease` |
| `git.destructive-reset` | destructive-command | medium | `git reset --hard`, `git clean -f…` |
| `shell.privilege-escalation` | privilege-escalation | medium | `sudo`, `su -`, `doas` |
| `shell.chmod-permissive` | privilege-escalation | medium | `chmod 777`, `a+rwx`, setuid `+s` |
| `secrets.access` | credential-access | high | `.ssh/`, `id_rsa`/`id_ed25519`, `.aws/credentials`, `.netrc`, `.npmrc`, `.pypirc`, `.git-credentials`, `.env`, `.docker/config.json`, `gh auth token` in a command or path |
| `persistence.autostart` | persistence | high | writes to shell profiles (`.bashrc`, `.zshrc`, `.profile`), `crontab`, `systemctl enable`, `launchctl load`, `authorized_keys` |
| `filesystem.system-path-write` | sensitive-file-write | high | file-write tool or redirect into `/etc/`, `/usr/`, `/bin/`, `/System/` |
| `network.data-upload` | data-exfiltration | medium | `curl`/`wget` with `-d`/`--data*`/`-F`/`-T`/`--upload-file`/`--post-file` |
| `network.raw-socket` | network-egress | medium | `nc`, `ncat`, `netcat`, `socat`, `telnet` |
| `network.remote-shell` | network-egress | low | `ssh`, `scp`, `rsync` to a `host:` target |
| `package.install` | package-install | low | `npm i`/`install <pkg>`, `yarn add`, `pnpm add`, `pip install`, `cargo install`, `go install`, `gem install`, `brew install`, `apt(-get) install` |
| `tool.denied` | permission-denied | medium | any call whose outcome status is `denied` |

Rules are **signals, not verdicts**. Every finding says *why* it matched
(rule `why` text plus the evidence excerpt), so a human can judge it. The
dashboard labels this section "Signals to review", not "attacks".

### 4.2 Anomalies

Session-level metrics are AI Credits (known sessions only), tool calls,
failure rate (sessions with ≥5 known outcomes), and output tokens. The
detector uses the robust z-score `0.6745·(x − median)/MAD`. It flags a
session when z > 3.5 on the high side, needs n ≥ 8 sessions, and skips
the metric when MAD = 0 (no spread to measure against). Severity is
medium, or high when z > 7. Each `why` names the actual value, the
median, the ratio and n, for example *"AI Credits 42.10 is 6.3× the
median 6.70 across 120 sessions (robust z = 8.1)"*. This method is
deterministic and explainable, with no model training.

### 4.3 Behaviour changes

Sessions with a `startedAt` are processed in chronological order. The
baseline is the first `max(3, ceil(25%))` sessions. A shell program,
tool name or model that first appears after the baseline becomes an
`info` finding with `at` set to the call's `startedAt` (falling back to
the session's), for example *"First use of program `nc`: not used in any
of the 37 earlier sessions since 2026-08-02"*. A new program that is
also on the risk list (`nc`, `socat`, `ssh`, `scp`, `curl`, `wget`,
`sudo`, `base64`, `crontab`, `chmod`) is raised to `low`.

## 5. Web design

```
lib/associative/        generic engine, no React (SRP, unit-tested in isolation)
  data-model.ts         TableDef / FieldDef types
  engine.ts             evaluate(model, selections) → { rowsOf(table), statesOf(field) }
  selections.ts         pure selection reducers (toggle, clear, clearAll) + history (back)
lib/insights/
  insights-model.ts     the four tables + field definitions for InsightsDataset
  measures.ts           KPI maths with coverage (AI Credits, tokens, cache hit ratio, failure rate…)
  narrative.ts          "What happened" summary text for the current selection
components/insights/
  InsightsDashboard.tsx container: loads the dataset, owns selections and history
  ListBox.tsx           searchable list box with selected/possible/alternative/excluded states
  CurrentSelections.tsx chips, clear-one, Clear all, Back
  FindingsTable.tsx     when · severity · what · why · where; click selects the session
  TrendColumns.tsx      (charts/) AI Credits by day; click selects the date
```

The engine runs on a tree of tables:

1. `local[T]`: rows of T matching T's own field selections.
2. Upward pass (post-order): a row survives if it is in `local` and, for
   every *constrained* child table (a table with selections in itself or
   a descendant), at least one of its children survives.
3. Downward pass (pre-order): a row is final if its parent row is final
   and it survived the upward pass.
4. Field states: values of final rows are *possible* (or *selected*).
   For a field that has a selection, the engine evaluates again without
   that field's own selection. Values that become possible are
   *alternative*, and everything else is *excluded*.

Layout is full width: on the left, a column of list boxes (Provider,
Date, Hour, Session, Model, Trigger event, Tool, Tool kind, Program,
Outcome, Failure category, Finding kind, Severity, Finding category).
On the right:

- the Current selections bar
- a "What happened" narrative
- KPI tiles: AI Credits, sessions, turns, cache hit ratio, output tokens,
  tool calls, failure rate, high-severity findings
- AI Credits by day (click to select the date)
- tokens by model (click to select the model)
- tool calls by tool (click to select the tool)
- failure categories (click to select the category)
- signals to review (findings table)
- most expensive sessions (click to select the session)

## 6. Testing (TDD)

Every unit is test-first:

- domain schema parse tests
- server: dataset builder, every security rule (positive and negative
  cases), scanner, anomaly detector, behaviour-change detector, service
  (fake providers, including one that throws and one that is
  unavailable), registry `listProviders`, and the `GET /api/insights`
  route (200, 400 on a bad range)
- web: engine (selection propagation through each table, alternative vs.
  excluded states, unknown values ignored), selections/history reducers,
  measures (coverage, unknown never counted as 0), narrative, ListBox,
  CurrentSelections, FindingsTable, TrendColumns, the dashboard container
  (clicking a list-box value updates KPIs and other list boxes), and the
  App wiring

## 7. Privacy and security

- The data comes from the same local providers and leaves the machine
  only over the loopback API (§11.2). Command text in tool-call rows and
  finding evidence is bounded and passes through `redactSecrets`/`excerptOf`.
- Nothing from the dashboard goes into the advice export bundle.
- The detectors only read. No rule executes, resolves or fetches
  anything.

## 8. Out of scope (follow-ups)

- MCP tools for findings (`list_security_findings`) over the same service.
- Turn-level linking of findings (needs a graph engine rather than a tree).
- Persisting selections and bookmarks (QlikView "bookmarks").
- A per-day spike detector (the daily chart already shows spikes; a
  finding needs a session to link to).

## 9. Decisions (from the user)

- Scope: **all available providers combined**, with Provider as a
  selectable field.
- Placement: a new **Dashboard** center view in Analyze mode, full width.
- Content: **cost & tokens**, **tool calls & failures**, and a **security
  focus** (suspicious patterns, anomalies, behaviour changes, each
  explaining what, when and why).

## 10. What shipped / known limitations

Everything in §3–§6 shipped.

Known limitations:

- `at` timestamps are as precise as each provider makes them. Claude Code
  records per-call timestamps. The other providers fall back to the
  session's `startedAt`.
- Rules match on the bounded, redacted command text (`shell.command`/
  `argsSummary`), so a pattern beyond the truncation point isn't seen.
- Sessions without `startedAt` are excluded from behaviour-change
  baselines and the date and hour fields, but are counted everywhere else.
