# Phase 15: Cost by repository and project, price history, billing and estimates

Status: **Proposed** (2026-11-05). Nothing is built yet. The owner decisions
this plan needs are listed in [§13](#13-open-decisions), each with a
recommendation. This document is the design. Its steps go into
[implementation-plan.md](../implementation-plan.md) as Phase 15 once the
decisions are made.

## Contents

1. [Context](#1-context)
2. [Goals and non-goals](#2-goals-and-non-goals)
3. [Concepts](#3-concepts)
4. [Where the data comes from](#4-where-the-data-comes-from)
5. [Cost model: billed, reported and priced](#5-cost-model-billed-reported-and-priced)
6. [Price book with history](#6-price-book-with-history)
7. [Projects: configuration](#7-projects-configuration)
8. [Analyses](#8-analyses)
9. [Architecture](#9-architecture)
10. [API and MCP](#10-api-and-mcp)
11. [User interface](#11-user-interface)
12. [Testing, privacy, risks](#12-testing-privacy-risks)
13. [Open decisions](#13-open-decisions)
14. [Implementation steps](#14-implementation-steps-tdd-each-with-an-exit-criterion)
15. [Exit criterion](#15-exit-criterion)

## 1. Context

Today every cost view is organised by **session**, and by **provider**,
**model** and **day** on the Dashboard (Phase 9.11) and in
`get_cost_rollup` (Phase 9.12). None of them can answer:

- *How much did repository X cost last month, and how does that compare
  with repository Y?*
- *How much did project P (repositories X, Y and Z together) cost over
  time?*
- *Within project P, how much went to each vendor (Anthropic, OpenAI,
  Google, …) and each model?*
- *What do I bill client C for October, and can I show how the number was
  worked out?*
- *How much will the next similar piece of work cost?*
- *When did a model's price change, and how much of a cost change came
  from the price, not from using it more?*

The analysis is also used for **billing** and **estimates**. So every
figure must be traceable to the turns and the prices behind it, an issued
bill must not change afterwards, and unknown costs must stay visibly
unknown (architecture.md constraint 6), never counted as zero.

## 2. Goals and non-goals

**Goals**

1. **G1 Repository attribution.** Every Analyze session (and, where the
   source records it, every turn) is attributed to a **repository**, or
   to an explicit **Unattributed** bucket with the reason.
2. **G2 Projects.** The user groups repositories into **projects**, and can
   narrow a project to part of a monorepo (a path) or to branches.
3. **G3 Cost over time.** Cost of a repository or project per day, week or
   month, plus a running total, for any date range.
4. **G4 Compare.** Two or more repositories or projects side by side: in
   absolute terms, normalised (per session, per active day) and as shares.
5. **G5 Vendor and model breakdown inside a project**, over time.
6. **G6 Price history.** Model prices are versioned with the dates they
   took effect. Each cost is computed at the price **in force when the turn
   ran**, and price changes show up as markers on every time chart.
7. **G7 Price versus usage.** A change in cost between two periods is split
   into a **usage effect** and a **price effect**.
8. **G8 Billing.** A monthly (or custom period) **statement** per project:
   lines by vendor and model, quantities, unit prices with their price
   version, coverage, and totals. It can be exported (CSV, JSON, Markdown)
   and **frozen**, so a later price-book update does not change a bill
   already issued.
9. **G9 Estimates.** A forecast with a range for future work on a project,
   from its own history: run rate, cost per session or active day, and
   "at today's prices".

**Non-goals**

- Not an invoicing or accounting system: no tax, no invoice numbers, no
  payment tracking. Statements are the evidence an invoice is built from.
- No live price fetching at runtime (constraint 1). The price book ships
  as reviewed data, updated by the same weekly diff workflow Phase 13
  plans (`vendor-prices.yml`), plus the user's own local rates.
- No cloud sync, no team or multi-user server (vision §6). A team can
  combine exported statements; the app does not.
- No splitting of one turn's cost across repositories by guesswork. A
  turn belongs to one repository, or is Unattributed.
- No reconstruction of plan seat fees (Copilot Business, Claude Max
  subscriptions). Only usage-based cost is measured; seat fees can be added
  as a fixed line on a statement by the user (§8.5).

## 3. Concepts

```mermaid
erDiagram
    PROJECT ||--o{ PROJECT_MEMBER : has
    PROJECT_MEMBER }o--|| REPOSITORY : "includes (optional path/branch scope)"
    REPOSITORY ||--o{ SESSION : "attributed to"
    SESSION ||--o{ TURN : contains
    TURN }o--|| MODEL : uses
    MODEL }o--|| VENDOR : "made by"
    PRICE_VERSION }o--|| MODEL : prices
    PRICE_VERSION }o--|| CHANNEL : "sold through"
    TURN ||--o{ COST_LINE : "priced as"
    COST_LINE }o--o| PRICE_VERSION : "uses (priced basis)"
    STATEMENT ||--o{ COST_LINE : "freezes"
    STATEMENT }o--|| PROJECT : "bills"
```

| Term | Meaning |
|---|---|
| **Repository** | One codebase, identified by a stable `repositoryKey` (§4.2). Clones, worktrees and a moved folder of the same remote are the same repository. |
| **Project** | A user-named group of repository members, optionally with a client name and a billing code. |
| **Project member** | A repository, optionally narrowed by a path prefix (monorepo) and/or branch patterns. |
| **Vendor** | The model maker: Anthropic, OpenAI, Google, xAI, … (already in Phase 13's `VendorProfile.vendorId`). |
| **Channel** | Who sold the tokens and in which unit: `github-copilot` (AI Credits), `anthropic-api` (USD), `openai-api` (USD), a cloud reseller, or a user-defined contract. The same model has different prices on different channels. |
| **Price version** | One model's prices on one channel from an `effectiveFrom` date until the next version. |
| **Cost basis** | How a cost figure was obtained: `billed`, `reported` or `priced` (§5). |
| **Statement** | A frozen, exported cost summary of one project for one period. |

## 4. Where the data comes from

### 4.1 What each provider records

Verified against the code in `packages/server/src/data-sources/`.

| Provider | Folder of the work | Repository / branch | Turn time | Cost today |
|---|---|---|---|---|
| VS Code, Agent Host / Copilot CLI session store (SQLite) | `sessions.cwd` | `sessions.repository`, `sessions.branch` | `turns.timestamp` | AI Credits, billed (`copilotUsageNanoAiu`) |
| VS Code, classic chat | the workspace of the `workspaceStorage/<hash>` folder the logs live in (its `workspace.json`) — **to verify** in step 15.1 | from that folder's git config | `main.jsonl` span times | AI Credits, billed |
| Claude Code | `cwd` on every JSONL entry | `gitBranch` on every entry; repository from the `cwd`'s git config | entry `timestamp` | tokens only (AI Credits `unknown`) |
| pi | session header `cwd` | from the `cwd`'s git config | entry `timestamp` | tokens, plus pi's own `Usage.cost` in USD |
| mitmproxy (HAR) | not recorded | not recorded | HAR `startedDateTime` | tokens only |

So every provider except mitmproxy can be attributed automatically. For
mitmproxy captures, the user assigns a capture file (or a folder of
captures) to a repository with a rule in the project file (§7).

### 4.2 Resolving a folder to a repository

`RepositoryResolver` turns a recorded folder (and, if present, a recorded
repository name) into a `RepositoryRef`. It reads files only. It never runs
`git` and never uses the network.

1. Walk up from the folder to the nearest `.git` entry. A `.git` *file*
   (worktree or submodule) is followed to its `gitdir`, and from there to
   the main repository's `commondir`.
2. Read `config` there. Take the `origin` remote (or the first remote) and
   **normalise** it: lower-case host, drop the scheme, user name, password
   or token, port and the trailing `.git`. Both
   `git@github.com:Org/App.git` and `https://x:TOKEN@github.com/org/app`
   become `github.com/org/app`. This is the `repositoryKey`.
3. With no remote, the key is `local:<absolute path of the main
   repository root>`.
4. If the folder no longer exists, use the provider's recorded repository
   name (VS Code session store) if there is one; otherwise key the session
   by its folder path, `path:<cwd>`, marked `confidence: "inferred"`.
   The user can merge such a key into a real repository with an alias
   (§7).
5. No folder at all: **Unattributed**, with the reason (for example
   "mitmproxy captures do not record a working folder").

The **path inside the repository** (`cwd` relative to the root) and the
**branch** are kept on the attribution too, so monorepo and branch scopes
(§7) can match them.

Results are cached per folder for the life of the server, like the other
provider caches. A session whose `cwd` changes between turns (Claude Code
records it per entry) is attributed **per turn**; the session then shows
under each repository it touched, with only that repository's turns.

## 5. Cost model: billed, reported and priced

The repository's sources record cost in different ways. This plan keeps
them apart and labels each figure with its **basis**, never mixing them
silently.

| Basis | Meaning | Sources | Trust |
|---|---|---|---|
| `billed` | The amount the vendor's billing recorded for this request | Copilot `copilotUsageNanoAiu` → AI Credits | Highest: this is what GitHub charges |
| `reported` | An amount the agent computed and logged itself | pi `Usage.cost` (USD) | The agent's own price table, which may be out of date |
| `priced` | Token counts × the price version in force at the turn's time (§6) | Every provider with token counts | As good as the price book; labelled **Priced** |

```ts
// packages/domain — sketch, zod schemas in the real code
type Currency = "AI_CREDITS" | "USD";

type CostFigure =
  | {
      known: true;
      amount: number;
      currency: Currency;
      basis: "billed" | "reported" | "priced";
      priceVersionIds?: string[]; // priced only: which versions were used
      estimated?: boolean;        // a token count behind it was a local-tokenizer estimate
    }
  | { known: false; reason: string }; // constraint 6: never 0
```

Rules:

- **Preferred basis per turn**: `billed` if present, else `reported`, else
  `priced`, unless the user picks one basis for a view (§13 D3). Each total
  shows how many turns each basis covers, extending today's `MeasureTotal`
  (`value`, `knownTurns`, `turns`).
- **Currency**: AI Credits and USD are converted only by the documented
  rate 1 AI Credit = $0.01 (Phase 13, GitHub's pricing page), and the view
  says it converted. A user currency (EUR, …) is a fixed rate the user
  enters per statement; the app never looks up exchange rates.
- **Reconciliation**: where a Copilot turn has both `billed` and `priced`
  figures, the difference is shown per model and month. A steady gap is a
  sign the price book is wrong or out of date, and raises a finding (§6.4).
- **Subscriptions** (Claude Max, Copilot plan allowances): tokens used under
  a flat-fee plan have no per-token bill. Their priced figure is labelled
  **API-equivalent**. It is useful for comparing and estimating, but a
  statement shows it only when the user opts in (§13 D4).

## 6. Price book with history

### 6.1 Data shape

Phase 13 adds `VendorProfile.models[].tiers` with today's prices and
`Source.checkedAt`. This plan adds **time** and **channel** to those prices,
without changing what Phase 13's simulator reads (it asks for "the price
in force now").

```ts
type PriceVersion = {
  id: string;               // "github-copilot:claude-sonnet-5-5:2026-09-01"
  channel: string;          // "github-copilot" | "anthropic-api" | "openai-api" | user channel id
  modelId: string;          // the price table's model id; provider ids are mapped (Phase 13 step 13.0 mapping)
  currency: Currency;
  effectiveFrom: string;    // ISO date (UTC), inclusive
  effectiveTo?: string;     // exclusive; absent = still in force
  tiers: PriceTier[];       // Phase 13's PriceTier, unchanged
  kind: "list" | "promo" | "contract";
  promoEndsAt?: string;     // as in Phase 13
  sourceIds: string[];      // cited sources, with checkedAt
  note?: string;            // "price cut announced 2026-08-20"
};
```

- The bundled history lives in `fixtures/price-book/<channel>.json`, one
  array of `PriceVersion` per channel. Versions of one model on one
  channel must not overlap, and gaps are allowed but flagged (a test
  enforces both).
- Phase 13's vendor profiles take their `tiers` from the newest version, so
  there is one source of truth. (If Phase 13 step 13.2 ships first, this
  step moves its price data into the price book; see step 15.5.)
- **User rates** (negotiated contract, reseller, internal markup) live in
  the user's local project file (§7), as `kind: "contract"` versions on
  user channels. They take precedence over list prices for the projects or
  repositories they are scoped to.

### 6.2 Which price applies

`PriceBook.priceFor(channel, modelId, at)` returns the version whose
`[effectiveFrom, effectiveTo)` contains `at`, or `unknown` with a reason
("no price for gpt-x on openai-api before 2026-03-01"). Then:

- `at` is the **turn's own timestamp**. A turn with no timestamp uses the
  session start, and the line says so.
- The tier is chosen per request, as Phase 13's `Pricer` does
  (`maxInputTokens`), so long-context prices apply correctly.
- Two pricing modes:
  - **As of use** (default, used for billing): the price in force when the
    turn ran.
  - **At today's prices** (used for estimates and comparisons): every turn
    priced at the newest version. Views show which mode they use.

### 6.3 Channel per provider

| Provider | Default channel | Why |
|---|---|---|
| VS Code (both stores) | `github-copilot` | Copilot bills in AI Credits |
| Claude Code | `anthropic-api` | API-key use; subscription users see API-equivalent (§5) |
| pi | the vendor of the model's API channel | pi calls vendor APIs directly |
| mitmproxy | the vendor whose decoder read the exchange | the captured host says which API was called |

The user can override the channel per provider or per repository in the
project file (for example "Claude Code on this machine goes through
Bedrock").

### 6.4 Price changes

Price changes come from two places, and the UI keeps them apart:

1. **Documented**: the boundary between two price versions of a model.
   `PriceChangeDetector` lists each change with old and new unit prices,
   the percentage change per token type, the date and the source. These are
   the markers on the time charts (§11).
2. **Observed** (Copilot only): each month, compare the billed AI Credits
   per model with the priced figure for the same turns. If the ratio moves
   by more than a threshold and stays there, raise an `InsightFinding`
   ("Observed: Claude Sonnet 5.5 billed 12% above the price book since
   2026-10-14"), `confidence: "inferred"`. It reuses the Phase 9.11
   finding pipeline. It is a prompt to check the price book, not a price
   change by itself.

## 7. Projects: configuration

Projects are the first **user-owned data** the app writes. Logs stay
read-only.

- **Where**: one local JSON file. Standalone app:
  `~/.agent-cost-analyzer/projects.json`, with the path overridable by an
  environment variable like the providers' own folders. VS Code extension:
  the extension's global storage. Validated with a zod schema on read; a
  bad file gives a config warning (like the startup config check, architecture.md §6.3), not a
  crash.
- **Why a file**: it is easy to back up, diff, and share with a colleague
  (it holds no message text). It can be imported and exported from the UI.

```jsonc
{
  "version": 1,
  "projects": [
    {
      "id": "acme-portal",
      "name": "ACME customer portal",
      "client": "ACME Ltd",
      "billingCode": "ACME-2026-07",
      "members": [
        { "repository": "github.com/acme/portal-web" },
        { "repository": "github.com/acme/platform", "path": "services/portal-api" },
        { "repository": "github.com/acme/infra", "branches": ["portal/*"] }
      ],
      "rates": { "markupPercent": 15 }          // optional, statements only
    }
  ],
  "aliases": {                                  // merge keys into one repository
    "path:/home/me/old-checkout": "github.com/acme/portal-web"
  },
  "captureRules": [                             // mitmproxy: file → repository
    { "glob": "~/captures/acme/*.har", "repository": "github.com/acme/portal-web" }
  ],
  "channels": {                                 // channel overrides and contract prices
    "providers": { "claude-code": "anthropic-api" },
    "priceVersions": []                         // user PriceVersion entries (§6.1)
  }
}
```

**Membership rule** (recommended, §13 D1): a turn belongs to **at most one
project**. If two members of different projects match the same turn, the
most specific one wins (path beats whole repository, branch beats no
branch), and an exact tie is a validation error shown in the UI. This keeps
project totals additive, which billing needs. Repositories with no project
appear under **No project**.

## 8. Analyses

All analyses are pure functions over one flat **cost cube**: one row per
turn with `date`, `repositoryKey`, `projectId`, `providerId`, `vendorId`,
`modelId`, `channel`, token counts and `CostFigure`s for each basis. It
extends the existing `InsightsDataset` turn rows, so the Dashboard's
associative filters (Phase 9.11) work on repositories and projects too.

### 8.1 Cost over time (G3)

Group by repository or project, bucket by day, ISO week or calendar month
(UTC by default, user time zone as an option), with a running total. Each
point carries coverage (turns known / turns) and the bases it contains.

### 8.2 Compare (G4)

For a chosen set of repositories or projects and a period:

| Measure | Why |
|---|---|
| Total cost | the headline |
| Cost per session, per active day, per turn | normalises for how much each was worked on |
| Share of total | where the money went |
| Cache-hit ratio, output share | why one costs more than another (existing `cacheHitRatio`) |
| Change versus the previous period | trend |

Shown as a table plus small multiples or an indexed line chart
(first period = 100), so a large and a small project can be compared.

### 8.3 Inside a project (G5)

Breakdown by vendor, then model, over time (stacked area per vendor,
drill-down to models), and by token type (uncached input, cache write,
cache read, reasoning, output) per model, since that is what prices
multiply.

### 8.4 Price versus usage (G7)

For two periods A and B, per model:

- **Usage effect** = (tokens in B − tokens in A) × price in A
- **Price effect** = tokens in B × (price in B − price in A)

The two add up to the cost change exactly, per token type, and are summed
over models. A **mix effect** (moving work to a different model) is shown
as its own line by computing usage at the model level. This answers "costs
went up 30%: was it the price change on 1 October or more work?"

### 8.5 Billing statements (G8)

`StatementBuilder` produces, for one project and one period:

- one line per (channel, model, price version) with token quantities by
  type, unit prices, amount and basis;
- lines for turns whose cost is unknown, with their count and reason, so
  nothing silently drops out;
- the user's markup and fixed lines (seat fees), if configured;
- totals per currency, the conversion used, and coverage;
- a provenance block: app version, price-book version, project-file hash,
  and the list of session ids included.

**Freezing**: "Issue statement" writes the statement as JSON under
`~/.agent-cost-analyzer/statements/<project>/<period>.json`. A frozen
statement is never recomputed. Re-running the period later shows a
**diff against the frozen copy** (late logs, a price-book fix) instead of
silently changing it. Exports: CSV (lines), JSON (full), Markdown (for a
client email). Exports contain session ids and titles but never message
text; titles can be omitted with an option.

### 8.6 Estimates (G9)

From a project's history (or a set of similar projects):

- **Run rate**: cost per active day and per week, trailing 4 and 12 weeks.
- **Unit costs**: median and 90th-percentile cost per session.
- **Forecast**: planned active days (or sessions) × the unit cost, given as
  a **range** (p50 to p90), never a single number, priced **at today's
  prices** so a past price cut does not inflate the estimate.
- **What if another model**: hands off to Phase 14 (replay on another
  vendor) when it exists; until then, a token-for-token reprice at another
  model's price, labelled **Simulated, same tokens assumed**.

An estimate is always labelled as one, with the history window it used.

## 9. Architecture

```mermaid
flowchart LR
  subgraph Providers["Log providers (unchanged contract)"]
    P1[VS Code] --- P2[Claude Code] --- P3[pi] --- P4[mitmproxy]
  end
  Providers -->|Session + turn timestamps + cwd| Attr[SessionAttributor]
  Resolver[RepositoryResolver<br/>git-config file reader] --> Attr
  Catalog[ProjectCatalog<br/>projects.json] --> Attr
  Attr --> Cube[CostCubeBuilder]
  Book[PriceBook<br/>bundled + user versions] --> Pricer[CostPricer]
  Pricer --> Cube
  Cube --> TS[TimeSeries / Compare / Breakdown]
  Cube --> Var[VarianceAnalyzer]
  Cube --> Stmt[StatementBuilder] --> Store[StatementStore]
  Cube --> Est[Estimator]
  Book --> PCD[PriceChangeDetector]
  TS & Var & Stmt & Est & PCD --> API[HTTP API + MCP tools]
  API --> Web[Web: Costs view] & Ext[VS Code extension]
```

New modules (server, under `services/cost-attribution/` and
`services/pricing/`; schemas in `packages/domain`):

| Module | Responsibility (S) | Depends on (D: interfaces only) |
|---|---|---|
| `RepositoryResolver` | folder → `RepositoryRef` | `FileSystem` port |
| `RemoteUrlNormalizer` | remote URL → key, strips credentials | — (pure) |
| `ProjectCatalog` | read, validate, write the project file; match a turn to a project | `ProjectStore` port |
| `SessionAttributor` | session/turn → repository + project | `RepositoryResolver`, `ProjectCatalog` |
| `PriceBook` | versions lookup by (channel, model, time) | `PriceBookSource` port (bundled file, user file, composite) |
| `CostPricer` | turn tokens × version → `CostFigure` | `PriceBook` |
| `CostCubeBuilder` | flat rows from attributed, priced turns | the two above |
| `TimeSeriesBuilder`, `ComparisonBuilder`, `VarianceAnalyzer`, `Estimator` | pure analyses over the cube | — |
| `PriceChangeDetector` | documented and observed changes | `PriceBook`, cube |
| `StatementBuilder` / `StatementStore` | build / freeze and diff statements | cube, `StatementStore` port |

SOLID notes:

- **Open/closed**: a new provider needs only to fill `Session.cwd`/
  `Turn.startedAt`; a new channel is data; a new analysis is a new pure
  builder over the cube.
- **Liskov**: every `PriceBookSource` returns the same validated
  `PriceVersion[]`; the composite source only orders them by precedence.
- **Interface segregation**: analyses read the cube, not providers.
- **Dependency inversion**: file access sits behind ports, so all logic is
  tested with in-memory fakes.

Domain changes (additive, all optional, so Learn mode and old callers are
unaffected):

- `Session.workspace?: { cwd?: string; repositoryHint?: string; branch?: string }`,
  filled by each provider from what it records (§4.1).
- `Turn.startedAt?: string` and `Turn.workspace?` (only where it differs
  from the session's, Claude Code).
- `InsightSessionRow`/`InsightTurnRow` gain `repositoryKey`, `projectId`,
  `vendorId`, `channel`, `date`, and `CostFigure`s.

## 10. API and MCP

All read endpoints are `GET` and follow §8's existing conventions
(`since`/`until` ISO dates, zod-validated responses).

| Endpoint | Returns |
|---|---|
| `GET /api/repositories` | repositories seen, with session counts, first/last use, project, and the Unattributed reasons |
| `GET /api/projects`, `PUT /api/projects` | the project file; `PUT` validates and writes it |
| `GET /api/cost/timeseries?groupBy=repository\|project\|vendor\|model&bucket=day\|week\|month&ids=…&pricing=as-of-use\|today&basis=preferred\|billed\|priced` | series with coverage and price-change markers |
| `GET /api/cost/compare?groupBy=…&ids=…&since&until` | the §8.2 table |
| `GET /api/cost/variance?groupBy=…&id=…&periodA=…&periodB=…` | usage, price and mix effects |
| `GET /api/price-book?channel&model` | price versions with sources |
| `GET /api/price-book/changes?since` | documented changes, and observed-change findings |
| `GET /api/statements?project&period` | a draft statement, or the frozen one with a diff |
| `POST /api/statements/:project/:period/issue` | freezes the draft |
| `GET /api/estimates?project&days\|sessions` | forecast range and the inputs used |

The two write endpoints are the app's first non-log writes. They need the
existing local-only binding and the CSRF/origin checks from the
[threat model](../threat-model.md), which gets a new row for them.

MCP tools (read-only, like the rest of the server): `get_cost_by_repository`,
`get_project_cost` (with vendor/model breakdown), `compare_costs`,
`get_price_changes`, `get_statement` (draft or frozen; issuing stays a UI
action). A prompt, `explain-cost-change`, chains `compare_costs` and the
variance analysis.

## 11. User interface

**Standalone app**: a new Analyze-mode **Costs** view next to the
Dashboard, with four tabs:

1. **Over time**: a line or stacked-area chart per repository/project, the
   range picker, the bucket picker, the basis and pricing-mode switches,
   and **vertical markers for price changes** (hover shows the model, old
   and new price, and the source). Coverage under 100% is shown on the
   point, not hidden.
2. **Compare**: the §8.2 table and indexed chart; pick repositories or
   projects with checkboxes.
3. **Project**: the vendor → model breakdown, token-type mix, the variance
   explanation between two chosen months, and the reconciliation gap for
   Copilot turns.
4. **Billing**: draft statement for a period, *Issue*, export, and the
   list of issued statements with their diffs. Plus **Estimate**: inputs
   (days or sessions, history window) and the forecast range.

A **Projects** settings page edits the project file: unassigned
repositories are listed first so they can be dragged into a project, and
validation errors (overlaps, unknown keys) are shown inline.

Charts follow the `dataviz` guidance and the Industry design system; the
existing D3 dependency is reused.

**VS Code extension** (Copilot only): the sidebar can group sessions by
repository as well as by day, the status bar shows today's AI Credits for
the **current workspace's** repository, and a compact Costs panel offers
the Over time and Project tabs. Billing and estimates stay in the
standalone app at first (§13 D7).

## 12. Testing, privacy, risks

### 12.1 Testing (TDD, architecture.md §11.4)

Each step starts with failing tests. The key ones:

- `RemoteUrlNormalizer`: SSH, HTTPS, credentials in the URL, ports, case,
  `.git` suffix, GitLab subgroups, Azure DevOps URLs — all map to the
  expected key, and no output ever contains a credential (property test).
- `RepositoryResolver` on fake file trees: plain repo, worktree,
  submodule, no remote, missing folder, nested repository.
- `ProjectCatalog`: specificity order, tie is an error, aliases, capture
  rules, schema errors become warnings.
- `PriceBook`: overlap rejected; boundary dates (inclusive from, exclusive
  to); no version gives `unknown` with reason; user contract version beats
  list price only in its scope.
- `CostPricer`: per-tier pricing; a turn spanning a price change is priced
  by its own timestamp; unknown tokens give unknown cost, never 0.
- `VarianceAnalyzer`: usage + price (+ mix) effects equal the total change
  exactly (property test over random inputs).
- `StatementBuilder`: golden statements; a frozen statement is unchanged
  after a price-book update, and the diff lists exactly the changed lines.
- Each provider: a fixture session yields the expected `workspace` and
  turn timestamps.

### 12.2 Privacy and security

- Folder paths and repository names are sensitive. They never leave the
  machine; exports include them only for the project being exported.
- Credentials embedded in remote URLs are stripped **before** anything is
  stored, logged or returned (tested).
- Git config is read as a file with a size limit and inside the resolver
  only; no `git` process, no hooks, no network.
- The two write endpoints write only inside the app's own config folder,
  with the same path-traversal checks the threat model already verifies.

### 12.3 Risks

| Risk | Mitigation |
|---|---|
| Classic VS Code chat may not record the workspace folder per session | Step 15.1 verifies it first; fallback is per-`workspaceStorage` folder, and if that fails, Unattributed with the reason |
| Old price history is incomplete | Versions carry sources; a missing period prices as `unknown`, and the UI says which models/months lack prices |
| Users treat priced (API-equivalent) figures as bills | Basis label on every figure; statements default to billed and reported only (D4) |
| Turn timestamps missing in some sources | Fall back to session start, flagged on the line |
| A repository moves or is renamed upstream | Aliases in the project file merge keys; history stays under one repository |
| Cube size over long histories | Built from the existing cached `InsightsDataset`; aggregated server-side; date range required for statements |

## 13. Open decisions

Each decision has a recommendation. They are the owner's to make; the plan
assumes the recommendation until they are recorded here.

| # | Question | Options | Recommendation |
|---|---|---|---|
| D1 | Can one turn count in two projects? | (a) exclusive, most specific wins; (b) many-to-many, totals not additive; (c) many-to-many with allocation percentages | **(a)**: billing needs additive totals; percentages can come later |
| D2 | Reporting currency | AI Credits only; USD only; both with the fixed 1 credit = $0.01 rate; plus a user currency per statement | **Both, plus an optional fixed-rate user currency on statements** |
| D3 | Which basis do totals use by default? | preferred (billed → reported → priced); one basis per view | **Preferred, with a per-view switch and per-basis coverage shown** |
| D4 | Do statements include API-equivalent (subscription) cost? | never; opt-in per project; always | **Opt-in per project** |
| D5 | Where does project config live? | local JSON file; app database; per-repo file committed to each repo | **Local JSON file** (§7) |
| D6 | Time zone for day/month buckets | UTC; user time zone | **User time zone for statements** (bills follow the calendar month where the user works), **UTC elsewhere** to match the Dashboard |
| D7 | Which product first? | standalone app; VS Code extension; both | **Standalone app first** (it sees every provider and vendor); the extension gets grouping and the status bar in a later step |
| D8 | How far back must price history go? | from first log on this machine; 12 months; current only | **From 2026-01-01**, sourced; earlier turns price as `unknown` unless the user adds versions |
| D9 | Should observed price changes (§6.4) raise findings? | yes; no | **Yes**, as `inferred` findings on the Dashboard |
| D10 | Estimates in scope now, or after Phase 14? | now (run rate, unit cost); after Phase 14 | **Now**, without cross-model replay; Phase 14 adds "on another model" |

## 14. Implementation steps (TDD, each with an exit criterion)

Steps 15.1–15.4 and 15.8 need no price data and can start once the
decisions are recorded. Steps from 15.5 on need Phase 13 step 13.2's vendor
data (or replace it, see 15.5).

| Step | Work | Exit criterion |
|---|---|---|
| 15.0 | Owner records D1–D10 in §13; threat-model rows for the new writes | Decisions recorded; threat model updated |
| 15.1 | **Workspace capture**: `Session.workspace`, `Turn.startedAt` (and per-turn workspace for Claude Code) in every provider; verify classic VS Code chat's folder source | Each provider's fixture test yields folder, branch and turn times; mitmproxy reports Unattributed with a reason |
| 15.2 | **RepositoryResolver** + `RemoteUrlNormalizer` | Unit tests of §12.1 pass; no credential in any output (property test) |
| 15.3 | **ProjectCatalog** + project file schema + `GET/PUT /api/projects`, `GET /api/repositories` | Schema, matching and API tests pass; a bad file gives a config warning |
| 15.4 | **Attribution in the dataset**: `repositoryKey`/`projectId` on Insights rows; Dashboard list boxes for both | Dashboard filters by repository and project; totals match the per-session totals |
| 15.5 | **Price book with history**: `PriceVersion` schema, bundled channel files with sources, user versions, `PriceBook` lookup; Phase 13 profiles read their current prices from it | Overlap/boundary/precedence tests pass; every version has a source; Phase 13 tests unchanged |
| 15.6 | **CostPricer + basis**: `CostFigure` on every turn row; reconciliation figures for Copilot turns | Pricing tests pass; unknown never sums as 0; billed vs priced shown per model-month |
| 15.7 | **Time series, compare, project breakdown** + their endpoints | Golden outputs for a fixture dataset across three providers and two projects |
| 15.8 | **Costs view, Over time and Compare tabs**, with price-change markers | Component tests; a UI check with the run skill at phone and desktop widths |
| 15.9 | **Price changes and variance**: `PriceChangeDetector`, observed-change finding, `VarianceAnalyzer`, Project tab | Effects add up exactly (property test); markers match price-book boundaries |
| 15.10 | **Statements**: builder, freeze, diff, CSV/JSON/Markdown export, Billing tab | Golden statements; a frozen statement survives a price-book update unchanged and the diff is exact |
| 15.11 | **Estimates** + Estimate panel | Forecast range tests on fixture histories; labelled as estimates in the UI |
| 15.12 | **MCP tools** of §10 | MCP tests with output schemas, as in Phase 9.12 |
| 15.13 | **VS Code extension**: group by repository, status bar per workspace repository | Extension tests; manual check list updated |
| 15.14 | **Docs**: architecture.md (domain, data flow, API), UserGuide, vscode-extension-guide, vision non-goals, README index | Docs reviewed by the owner |

## 15. Exit criterion

On a machine with Copilot, Claude Code and pi sessions across at least three
repositories grouped into two projects:

- the Costs view shows each repository's and project's cost per month,
  with coverage, and marks every documented price change in the range;
- the Project tab splits one project's cost by vendor and model, and
  explains the change between two months as usage, price and mix effects
  that add up exactly;
- a statement for one project and month can be issued, exported, and still
  shows the same figures after a price-book update, with the diff listed
  separately;
- no unknown cost is shown or summed as zero anywhere.
