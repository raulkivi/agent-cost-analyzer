# Phase 15: Cost by repository and project, price history, billing and estimates

Status: **In progress**: steps 15.0–15.11 are done (see §14.1). The owner accepted
every recommended decision on 2026-11-05 ([§13](#13-decisions)). The UI
design (§11) was then revised against the project's existing design and UX
guidance. This document is the design; Phase 15 in
[implementation-plan.md](../implementation-plan.md) points here.

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
10. [API and MCP](#10-api-and-mcp), with the MCP tools in [§10.1](#101-mcp-tools)
11. [User interface](#11-user-interface)
12. [Testing, privacy, risks](#12-testing-privacy-risks)
13. [Decisions](#13-decisions)
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
   name (VS Code session store) if there is one: a full remote (with or
   without a scheme) keys like one; a plain `owner/name` keys as
   `repository:<name>`; anything else is ignored. Otherwise key the session
   by its folder path, `path:<cwd>`, with `source: "folder-path"`. An
   existing folder outside any repository keys the same way. The user can
   merge such a key into a real repository with an alias (§7).
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
  `priced`, unless the user picks one basis for a view (D3). Each total
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
  statement shows it only when the user opts in (D4).

## 6. Price book with history

### 6.1 Data shape

Phase 13 adds `VendorProfile.models[].tiers` with today's prices and
`Source.checkedAt`. This plan adds **time** and **channel** to those prices,
without changing what Phase 13's simulator reads (it asks for "the price
in force now").

```ts
type PriceVersion = {
  id: string;               // "github-copilot:claude-sonnet-5.5:2026-10-26"
  channel: string;          // "github-copilot" | "anthropic-api" | "openai-api" | user channel id
  modelId: string;          // the price table's model id; provider ids are mapped (Phase 13 step 13.0 mapping)
  currency: "USD";         // tiers are Phase 13's PriceTier, USD per 1M tokens
  effectiveFrom: string;    // ISO date (UTC), inclusive
  effectiveTo?: string;     // exclusive; absent = still in force
  tiers: PriceTier[];       // Phase 13's PriceTier, unchanged
  kind: "list" | "promo" | "contract";
  promoEndsAt?: string;     // as in Phase 13
  sourceIds: string[];      // cited sources, with checkedAt
  note?: string;            // "price cut announced 2026-08-20"
  scope?: { projectId: string } | { repository: string }; // contract only
};
```

- The bundled history lives in `fixtures/price-book/<channel>.json`, one
  object per channel, `{ channel, sources: Source[], versions: PriceVersion[] }`,
  so each version's `sourceIds` resolve to dated sources in the same file. Versions of one model on one
  channel must not overlap, and gaps are allowed but flagged (a test
  enforces both).
- Phase 13's vendor profiles take their `tiers` from the newest version, so
  there is one source of truth. (If Phase 13 step 13.2 ships first, this
  step moves its price data into the price book; see step 15.5.)
- **User rates** (negotiated contract, reseller, internal markup) live in
  the user's local project file (§7), as `kind: "contract"` versions on
  user channels. They take precedence over list prices for the projects or
  repositories they are scoped to. Precedence: a repository contract, then
  a project contract, then an unscoped contract, then the list or promo
  price.

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
   by more than a threshold and stays there (D11: more than 5%, the same
   way, in 2 ISO weeks in a row with at least 20 compared turns each),
   raise an `InsightFinding`
   ("Observed: Claude Sonnet 5.5 billed 12% above the price book since
   2026-10-14"), `confidence: "inferred"`. It reuses the Phase 9.11
   finding pipeline. It is a prompt to check the price book, not a price
   change by itself.

## 7. Projects: configuration

Projects are the first **user-owned data** the app writes. Logs stay
read-only.

- **Where**: one local JSON file. Standalone app: `projects.json` in the
  app's settings folder, beside its `settings.json` (`resolveAppSettingsDir`,
  so the same override applies). VS Code extension: the extension's global
  storage. Validated with a zod schema on read; a bad file gives an optional
  config warning (like the startup config check, architecture.md §6.3), not a
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

**Membership rule** (decided, D1): a turn belongs to **at most one
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
as its own line by computing usage at the model level (D12): per token
type, the **volume effect** is (all models' tokens in B − in A) × A's
average price for that type, and the **mix effect** is the sum of the
per-model usage effects minus the volume effect. Usage (volume), price and
mix then add up exactly to the change. This answers "costs
went up 30%: was it the price change on 1 October or more work?"

Effects need a unit price, so the variance is on the **priced** basis, as
of use: each priced turn carries its cost per token type (uncached input,
cache read, cache write, output: the types the pricer charges), and a
cell's unit price is its cost ÷ its tokens. A model with no tokens of a
type in one period takes the other period's unit price, so a new or
dropped model is all usage; likewise a token type with no tokens in A
takes B's average price for the volume effect. Totals are per currency (AI Credits for
Copilot, USD for the APIs), or all in USD at 1 AI Credit = $0.01. Turns
without a priced figure are counted, with the cost the view's basis gives
them, as **not explained**, never as 0 (constraint 6).

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
`statements/<project>/<period>.json` in the app's settings folder (beside
`projects.json`, so `resolveAppSettingsDir`'s override applies; step
15.11). Months are calendar months in the statement's time zone (D6): the
machine's, as the server reports it, written into the statement. Only an
ended period can be issued (D15). A frozen
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
  API --> Web[Web: Dashboard cost tabs] & Ext[VS Code extension]
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
| `GET /api/cost/timeseries?groupBy=repository\|project\|vendor\|model&bucket=day\|week\|month&ids=…&pricing=as-of-use\|today&basis=preferred\|billed\|reported\|priced&currency=native\|usd&since&until&provider&limit` | `CostSeries`: series with coverage and price-change markers (built in 15.7; `ids` needs `groupBy`, up to 20; dates are inclusive ISO dates; project cost is `groupBy=project`, see §14.1) |
| `GET /api/cost/compare?groupBy=repository\|project&ids=…&since&until&comparePeriod=previous\|last-year&basis&pricing&currency&provider&limit` | `CostComparison`: the §8.2 table (built in 15.7; 2 to 20 ids, `since` and `until` required) |
| `GET /api/cost/variance?groupBy=repository\|project&id=…&periodA=…&periodB=…&currency&provider&limit` | `CostVariance`: usage, price and mix effects per currency, model and token type (built in 15.10; a period is `YYYY-MM` or `YYYY-MM-DD..YYYY-MM-DD`; priced basis, as of use) |
| `GET /api/cost/project?projectId=…&since&until&bucket&basis&pricing&currency&provider&limit&topSessions` | `ProjectCost`, as MCP `get_project_cost` (added in 15.10 for the Project tab; 404 for an unknown project) |
| `GET /api/price-book?channel&model` | price versions with sources |
| `GET /api/price-book/changes?since&until&channel&model&kind=documented\|observed&provider&limit` | `PriceChangeList`: documented changes and observed ones, oldest first (built in 15.10; observed changes are also `price-change` findings in `GET /api/insights`) |
| `GET /api/statements?projectId&period&provider&limit` | `StatementAnswer` (built in 15.11): the frozen statement with the re-run and its exact diff, else the draft; whether it can be issued (D15) and why not; the project's issued periods. 404 unknown project, 400 bad period |
| `POST /api/statements/:projectId/:period/issue` | Freezes the draft (built in 15.11). JSON only (415 otherwise, so no cross-origin form can issue); 409 for an open or already issued period |
| `GET /api/estimates?project&days\|sessions` | forecast range and the inputs used |

The two write endpoints are the app's first non-log writes. They need the
existing local-only binding and the CSRF/origin checks from the
[threat model](../threat-model.md), which gets a new row for them.

MCP tools are specified in §10.1.

### 10.1 MCP tools

This extends the MCP server of Phase 9.12
([mcp-tools-v2.md](mcp-tools-v2.md)) and follows its conventions:

- names are `verb_noun` in snake_case, and none of the existing tools is
  renamed;
- every description starts with when to use the tool, then its defaults;
- every tool is annotated read-only (`READ_ONLY`) and declares an
  `outputSchema` that is the same domain zod schema the HTTP API returns;
- results are JSON plus `structuredContent`;
- a `null` figure is unknown, never zero, and every total carries its
  coverage (`knownTurns`, `turns`), as in today's `MeasureTotal`.

**Timing.** Each tool ships in the same step as the builder it calls
(§14), not in a separate MCP step at the end. So MCP and the Dashboard
read the same builders and agree from the first step, and each builder's
output schema is designed for both from the start.

#### 10.1.1 New tools

Like `get_cost_rollup`, every new tool reads **every available provider**
unless `provider` is given, and lists unavailable providers in
`providers[]` rather than dropping their spend. `since`/`until` are the
existing ISO date arguments (inclusive). Where a tool has a `currency`
argument, the default is `"native"`: each figure stays in the unit it was
recorded in, and totals are given per currency. `"usd"` converts at 1 AI
Credit = $0.01 and says so in `conversion`.

| Tool | Step | Input | Returns (`outputSchema`) |
|---|---|---|---|
| `list_repositories` | 15.4 | `provider?`, `since?`, `until?`, `projectId?`, `includeUnattributed?` (default true), `includePaths?` (default false) | `RepositoryList`: each repository's `repositoryKey`, project, session and turn counts, first and last use, cost with coverage; Unattributed buckets with their reasons |
| `list_projects` | 15.4 | none | `ProjectList`: each project's id, name, client, billing code, members (repository key, path and branch scopes); validation problems, if any |
| `get_price_book` | 15.5 | `channel?`, `model?`, `at?` (ISO date: the version in force then) | `PriceBookListing` (an MCP `outputSchema` must be an object): `channels`, `versions` with their `origin` (`bundled` or `user`), `sources` with `checkedAt`, `gaps`, `unknown` with reasons, and `problems` |
| `get_repository_cost` | 15.7 | `repository` (key from `list_repositories`), `since?`, `until?`, `bucket?` (`day`/`week`/`month`, default `month`), `basis?` (`preferred`/`billed`/`reported`/`priced`), `pricing?` (`as-of-use`/`today`), `currency?`, `provider?`, `limit?` (sessions per provider, as in `get_cost_rollup`) | `CostSeries`: totals with coverage by basis; one point per bucket with coverage; breakdown by vendor and model; price-change markers in the range. As built it is exactly `GET /api/cost/timeseries?groupBy=repository&ids=<repository>` |
| `get_project_cost` | 15.7 | `projectId`, the same options as above, `topSessions?` (default 10, max 50) | `ProjectCost`: as `CostSeries`, plus a breakdown by repository member, by vendor → model and by token type, and the most expensive sessions |
| `compare_costs` | 15.7 | `groupBy` (`repository`/`project`), `ids` (2 to 20), `since`, `until`, `comparePeriod?` (`previous`/`last-year`, default `previous`), `pricing?`, `currency?`; as built also `basis?`, `provider?`, `limit?` | `CostComparison`: the §8.2 measures per id (total, change, per session, per active day, share, cache-hit ratio, output share, coverage) |
| `explain_cost_change` | 15.10 | `groupBy`, `id`, `periodA`, `periodB` (each `YYYY-MM` or a `since`/`until` pair), `currency?` | `CostVariance`: usage, price and mix effects per model and in total, which add up exactly to the change, with the price versions behind the price effect |
| `get_price_changes` | 15.10 | `since?`, `until?`, `channel?`, `model?`, `kind?` (`documented`/`observed`, default both) | `PriceChangeList`: each change's model, channel, date, old and new unit prices per token type, percentage, and either its source (documented) or its evidence with confidence `inferred` (observed) |
| `get_statement` | 15.11 | `projectId`, `period` (`YYYY-MM` or a range), `includeLines?` (default true) | `Statement`: the frozen statement if one is issued, with the diff against a re-run, else the draft; lines, unknown-cost lines with reasons, totals per currency, markup, fixed lines, provenance. It never issues one: issuing writes a file and stays a UI action |
| `estimate_cost` | 15.12 | `projectId` (or `repository`), `activeDays` or `sessions`, `historyWeeks?` (4 or 12, default 12) | `CostEstimate`: a p50–p90 range at today's prices, the unit costs and history window used, labelled `"estimate"`. Never a single number |

#### 10.1.2 Changes to existing tools

| Tool | Step | Change |
|---|---|---|
| `list_sessions` | 15.4 | Adds `repository?` and `projectId?` filters. Each session in the response gains `repositoryKey` (or `null` with `unattributedReason`) and `projectId` |
| `get_session_cost` | 15.6 | Adds the session's repository and project, a per-basis cost (`billed`, `reported`, `priced`) with coverage, and the price versions used. The existing AI Credits figures don't change |
| `get_cost_rollup` | 15.6 | Adds `repository?` and `projectId?` filters, breakdowns by repository, project, vendor and channel, and per-basis totals |
| `get_turn` | 15.6 | Adds the turn's `CostFigure`s and its price version |
| `list_findings` | 15.10 | Adds `kind: "price-change"` for observed price changes (§6.4), with the same shape as the other findings |

#### 10.1.3 Prompts

Prompt names stay snake_case like the existing ones (`audit_session`,
`review_costs`, `security_review`).

| Prompt | Step | What it asks the model to do |
|---|---|---|
| `explain_cost_change` (`groupBy`, `id`, `periodA`, `periodB`) | 15.10 | Call `compare_costs` and the `explain_cost_change` tool, then `get_price_changes` for the models with the largest price effect; say whether usage, price or mix drove the change, and what to do about each |
| `prepare_statement` (`projectId`, `period`) | 15.11 | Call `get_statement`; summarise totals, unknown-cost lines and any diff against an issued statement; draft a short note to the client. It reminds the user that issuing is done in the app |
| `estimate_work` (`projectId`, `activeDays`) | 15.12 | Call `estimate_cost` and `get_project_cost`; give the range, its inputs and the main uncertainty |

`review_costs` (Phase 9.12) also gets a step that groups its findings by
project when projects exist (15.7). The prompt and the tool named
`explain_cost_change` are separate registrations, as MCP keeps tools and
prompts apart.

#### 10.1.4 Server design (SOLID)

- **Tool groups.** Three new modules next to the existing ones, so adding
  them changes no other group (OCP):
  - `mcp/attribution-tools.ts`: `list_repositories`, `list_projects`;
  - `mcp/pricing-tools.ts`: `get_price_book`, `get_price_changes`;
  - `mcp/billing-tools.ts`: `get_statement`, `estimate_cost`.

  `get_repository_cost`, `get_project_cost`, `compare_costs` and
  `explain_cost_change` go into the existing `mcp/cost-tools.ts`, and the
  new prompts into `mcp/prompts.ts`. New argument schemas (`repositoryArg`,
  `projectIdArg`, `bucketArg`, `basisArg`, `pricingArg`, `currencyArg`,
  `periodArg`) go into `mcp/tool-helpers.ts` and are shared with the HTTP
  query-parameter schemas, so both surfaces validate the same way.
- **Dependencies.** Tools call `AnalysisQueryService`, which gains methods
  over the §9 builders through narrow interfaces (`CostCubeSource`,
  `PriceBookReader`, `StatementReader`). The MCP layer never touches the
  registry, the project file or the price-book files directly (DIP).
- **Same numbers everywhere.** MCP and the HTTP API call the same
  builders, over the same cost cube the Dashboard uses.
- **Products.** Today `createMcpServer` registers every group, and the
  extension's Copilot-only server (vscode-extension.md step 10.8) gets the
  same tools. It gains a `toolGroups` option, next to the `McpIdentity`
  option that already holds per-product texts. The extension leaves out
  `billing` (D7: billing and estimates are standalone-only at first) and
  keeps the rest, over the Copilot provider.
- **Instructions.** `STANDALONE_MCP_IDENTITY.instructions` (and the
  extension's identity) gain:
  - a workflow line: `list_repositories`/`list_projects`, then
    `get_project_cost` or `compare_costs`, then `explain_cost_change`;
  - what billed, reported and priced mean, and that priced figures depend
    on the price book (`get_price_book`);
  - "as of use" versus "today's prices";
  - the 1 AI Credit = $0.01 conversion, and that no other exchange rates
    are used;
  - that statements are issued only in the app.
- **MCP Apps.** An interactive project-cost view for MCP Apps hosts is
  not part of this phase. It belongs to Phase 12
  ([mcp-apps.md](mcp-apps.md)) and would render `get_project_cost`'s
  `structuredContent`, which is why that schema carries the series and
  breakdowns, not only totals.

#### 10.1.5 Security and privacy

Tool output enters the client model's context, which is usually a hosted
model ([mcp-tools-v2.md §6](mcp-tools-v2.md#6-security)). So:

- Repositories are identified by their **normalised key**
  (`github.com/org/repo`), never by local folder paths. `local:` and
  `path:` keys are returned as the folder's name only, unless
  `includePaths: true` is passed to `list_repositories`.
- Remote URLs have credentials stripped **before** they reach the cube
  (§4.2), so no tool can return one; a test checks every tool's output.
- Client names and billing codes are returned only by `list_projects` and
  `get_statement`, the two tools that need them.
- No tool writes. Issuing a statement and editing projects stay UI
  actions behind the CSRF/origin checks (§10).
- `estimate_cost` always returns a range labelled as an estimate, and its
  description says so, so a model doesn't quote it as a price.

#### 10.1.6 Testing and exit criterion

Tests (TDD, as in Phase 9.12, in `mcp-server.test.ts` and one test file
per new group), each written in the step that adds the tool:

- each tool's output parses against its `outputSchema`, including the
  partial-coverage and all-unknown cases;
- for the same fixture, each MCP tool and its HTTP endpoint return the
  same figures;
- unknown costs come back as `null` with a reason, never `0`;
- no output contains a credential or, without `includePaths`, a local
  path (property test over generated remote URLs and folders);
- the extension's server lists no `billing` tools.

Exit criterion, checked in step 15.13 over stdio on a fixture with
Copilot, Claude Code and pi sessions across three repositories in two
projects:

- the standalone `tools/list` returns the 9 Phase 9.12 tools plus the 10
  new ones (19), all read-only with an `outputSchema`; the extension's
  returns 17 (without `get_statement` and `estimate_cost`);
- `prompts/list` adds `explain_cost_change`, `prepare_statement` and
  `estimate_work` (6 in all; the extension leaves out the last two);
- `get_project_cost` reports a priced figure with the price version it
  used, next to a billed Copilot figure;
- `explain_cost_change` across the Sep 1 price change returns effects that
  add up exactly to the change.

## 11. User interface

The UI follows the project's existing guidance. It adds no new style of
its own:

- the "Industry" design handoff in [`Design/README.md`](../../Design/README.md);
- the Dashboard's associative model and layout
  ([insights-dashboard.md](insights-dashboard.md) §2, §5 and §10);
- the UX and accessibility standards in
  [vscode-extension.md §3.5](vscode-extension.md#35-ux-and-accessibility-standards),
  which bind both products because the UI code is shared;
- the lessons of the [10.11 UX review](vscode-extension.md#1011-ux-review-for-vs-code-owners-report-2026-10-24);
- the `dataviz` chart rules (one axis, fixed categorical order, legends,
  hover layer, a table view).

§11.6 lists how each rule applies here.

### 11.1 Where it lives: the Dashboard, not a new view

Cost by repository and project is a **new section of the existing
Dashboard** (the Analyze-mode, all-provider view of Phase 9.11), not a
separate Costs view. The reasons:

- the Dashboard already answers "what is driving my spend" with the
  associative model, selection chips, Back, KPI tiles with coverage and
  "View as table". A second cost view would split those answers in two;
- new **list boxes** for *Project*, *Repository*, *Vendor*, *Channel* and
  *Cost basis* join the existing ones (Provider, Date, Model, …). So
  clicking a project in a list box filters every chart, and clicking a
  model in a chart filters the project lists, as the rest of the Dashboard
  already does. This needs only new fields in the insights model (§9),
  not a new engine;
- the Dashboard already shipped its narrow-width order (filters column down
  to 720 px, insights first below that). The new section inherits it.

The Dashboard gains a **SegmentedControl** at the top of its right side:
*Overview* (today's content), *Cost over time*, *Compare*, *Project*
(§11.4) and *Billing*. The selections are shared across all five, so a
selection made in one stays in force in the others. Below 700 px the
tabs become a view `select`, as the session view already does.

### 11.2 Cost over time

- **Filters, in one row above the charts**: the date range first, with
  presets (*This month*, *Last month*, *Last 90 days*, *This year*) before a
  custom range; then the bucket (*Day / Week / Month*), the currency
  (*AI Credits / USD*) and the pricing mode (*As of use / Today's prices*).
  The filters use the existing `SegmentedControl` and `select` primitives.
- **KPI tiles** (`StatTile`): total cost, change versus the previous
  period, cost per active day, coverage. Coverage below 100% uses the
  tile's `note`, for example "412 of 430 turns priced". A partial total is
  never shown as complete.
- **One series** (one project, one repository, or the whole selection):
  `TrendColumns`, as on the Dashboard today, with a cumulative line only as
  a separate small chart. It is **never a second y-axis on the same chart**.
- **Two to four series**: a line chart with a direct label at each line's
  end, plus a legend.
- **Five or more series**: small multiples, one per project or repository,
  on a shared y-scale, with *Shared scale / Own scale* as a toggle. Lines
  are not overlaid past four.
- **Vendor split inside one project**: stacked columns by vendor. A 2 px
  surface gap separates the segments. Vendors beyond the eighth fold into
  "Other".
- **Unknown cost is a gap, never zero**: a bucket whose cost is all unknown
  is left out and drawn as a break in the line, as the Dashboard's daily
  chart already does. A bucket with partial coverage carries a hatched cap
  and its coverage in the tooltip.
- **Price-change markers**: a hairline at the change date, plus a small
  outline `Tag` above the plot ("Price: Sonnet 5.5 −20%"). The marker is
  keyboard-focusable and has a tooltip with the model, the old and new
  unit prices and the source. The table view lists price changes in rows
  of their own. Documented changes use a solid line; observed (inferred)
  changes use a dashed line and the label "Observed", so the two never
  differ by colour alone.
- **Hover layer**: a crosshair and tooltip on lines; a tooltip per column
  on columns. Hit targets are at least 24 px.
- **Clicking a column or point selects that period**, so the chart is a
  selection surface like `TrendColumns` today.

### 11.3 Compare

- A **table** first (the §8.2 measures). The repositories or projects come
  from the list-box selection; no separate checkbox picker. AI Credits have
  2 decimals and tabular figures, and units are shown in the headers.
- Below 700 px the table keeps its **priority columns** (name, total,
  change, coverage) and the rest move to the details drawer, as the turns
  table does. Users can choose which columns stay visible.
- An **indexed line chart** (first period = 100). It compares the shape
  of a large and a small project on one axis, without a second scale.
- "Share of total" uses horizontal bars (`HorizontalBars`), not a pie.

### 11.4 Inside a project

- `HorizontalBars` by vendor, then by model when a vendor is selected,
  with token type (uncached input, cache write, cache read, reasoning,
  output) as a second bar chart, not stacked into the first.
- **Price versus usage** (§8.4): a waterfall from period A's cost to
  period B's (usage, then price, then mix effect), with each step labelled
  with its signed amount and also listed in a table. Increases and
  decreases use the diverging pair plus a + or − sign, never colour alone.
- **Billed versus priced gap** (Copilot turns): shown as a finding with
  the existing `StatusTag` (icon plus text), not as a new colour.

### 11.5 Billing, estimates and projects

- **Billing**: the draft statement is a table inside a `Blueprint` card,
  with absolute dates (a bill needs exact dates, not "Today 14:02"). The
  *Issue statement* button opens a confirmation dialog, because the action
  writes a file. Export uses the existing export-dialog pattern
  (`AdviceExportDialog`): format choice, a preview, and Copy or Save.
  Issued statements are listed with a `Tag` "Frozen" and, if a re-run
  differs, a `StatusTag` warning "Differs from issued" with the diff one
  click away.
- **Estimate**: a panel inside Billing. The forecast is shown as a
  **range** (p50 to p90) on a horizontal interval with the two ends
  labelled, plus the inputs used (history window, pricing mode). It is
  labelled "Estimate" and never shown as a single number.
- **Projects editor**: a settings page in the same style as the Setup
  view. Unassigned repositories are listed first. Each row has a
  **Project `select`** to assign it. Drag and drop may be added as an
  extra, but it is never the only way (WCAG 2.2 2.5.7 Dragging
  Movements). Validation errors (overlapping scopes, unknown keys) are
  shown inline next to the field and summarised at the top, and Save is
  disabled while any remain.
- **States** use the shared `AsyncView`:
  - *Empty, no repositories found*: why (for example "only mitmproxy
    captures, which record no folder"), with a link to capture rules;
  - *Empty, no projects*: "Group repositories into a project to bill and
    compare them", with a *Create project* button;
  - *Partial*: a warning with the uncovered turns, never a zero;
  - *Error*: what failed, that nothing was changed, Retry and Copy details.

### 11.6 Guidance checklist

| Source | Rule | How it applies here |
|---|---|---|
| Design README | Use `theme.css` tokens, never hex; reuse `Blueprint`, `Tag`, `SegmentedControl` | All new parts are built from `components/ui/*` and the chart kit in `charts/` |
| Design README | No emoji | Markers, statuses and chips use `Tag`/`StatusTag` and text |
| Design README | Height-capped scroll areas for long content | Statement lines and the compare table scroll inside their card |
| §3.5 Accessibility | WCAG 2.2 AA; axe clean in dark, light and High Contrast | `vitest-axe` tests for each new tab in the three theme fixtures |
| §3.5 Accessibility | Every chart has an `aria-label` summary and "View as table" | Every new chart uses `ViewAsTable`/`ChartDataTable`; unknown cells say "unknown" |
| §3.5 Accessibility | Keyboard: arrows in lists, Enter opens, Escape closes; focus visible | List boxes and charts reuse `on-key-activate`; price markers are in the tab order |
| §3.5 Accessibility | Status never by colour alone | Price markers solid vs dashed plus label; variance steps signed; gaps via `StatusTag` |
| §3.5 Accessibility | `prefers-reduced-motion`; `aria-live` for async results | No chart transitions under reduced motion; totals announced when selections change |
| §3.5 Layout | Layout by panel width (`layoutFor`), minimum 360 px | New tabs use `use-container-width`; priority columns and drawer below 700 px |
| §3.5 States | One `AsyncView` pattern; partial is a warning, never 0 | §11.5 states |
| §3.5 Content | Sentence case, units always, AI Credits 2 decimals, tabular figures, relative dates with absolute tooltip | Same, except statements, which use absolute dates |
| §3.5 Performance | Interactions under 100 ms | The cube is aggregated on the server; the browser only filters (as the Dashboard does) |
| 10.11 review | Nothing past the panel's right edge; text contrast on the real ground; no Industry corner marks or uppercase labels in VS Code | The UI check (`npm run test:ui`) adds the new tabs at 600, 900, 1200 and 1600 px in the three themes |
| dataviz | One axis; small multiples or indexing instead of two scales | §11.2, §11.3 |
| dataviz | Categorical colours in fixed order, following the entity; 8 at most, then "Other" | A new validated categorical palette (§11.7); a vendor or project keeps its colour when filters change |
| dataviz | Legend for 2+ series; direct labels up to 4 | §11.2 |
| dataviz | Status colours reserved | Status colours only for warnings and gaps, never as a series colour |
| dataviz | Filters in one row, date range first with presets | §11.2 |

### 11.7 One new design-system addition: a categorical palette

The chart kit has no colours for categories today. `TrendColumns` and
`HorizontalBars` use the accent, and `StackedColumns` uses status colours
for tool-call outcomes. Vendors and projects need **identity** colours, so
this phase adds eight categorical tokens (`--color-series-1` to `-8`) to
`theme.css`. They are the dataviz reference palette, in its fixed order:

| Slot | Hue | Light (Industry ground `#f2f2f3`) | Dark (VS Code Dark Modern `#1f1f1f`) |
|---|---|---|---|
| 1 | blue | `#2a78d6` | `#3987e5` |
| 2 | orange | `#eb6834` | `#d95926` |
| 3 | aqua | `#1baf7a` | `#199e70` |
| 4 | yellow | `#eda100` | `#c98500` |
| 5 | magenta | `#e87ba4` | `#d55181` |
| 6 | green | `#008300` | `#008300` |
| 7 | violet | `#6250d6` | `#9085e9` |
| 8 | red | `#e34948` | `#e66767` |

Validator results (2026-11-05, `validate_palette.js`):

- **Light, on `#f2f2f3`**: lightness, chroma, colour-blind separation
  (worst adjacent ΔE 9.1) and normal-vision floor all pass. Contrast
  against the ground is a **warning** for orange, aqua, yellow and magenta
  (1.9–2.9:1). The validator allows this only with relief, and the design
  provides it: direct labels on every line up to four series, values in
  tooltips, and "View as table" on every chart.
- **Dark, on `#1f1f1f`**: every check passes (worst adjacent ΔE 8.4, all
  ≥ 3:1).
- **VS Code's own chart colours fail.** On Dark Modern,
  `charts.orange`, `green`, `purple` and `yellow` fall outside the
  lightness band (too light next to blue and red). So, correcting the
  first draft of this section, `theme-vscode.css` does **not** map series
  to `--vscode-charts-*`. It uses the dark steps above in dark themes and
  the light steps in light themes.

In High Contrast, series also differ by dash pattern (solid, `7 4`,
`2 3`), because the theme flattens colours; board 7 shows it.
`theme-contrast.test.ts` gets the new tokens in Dark Modern, Light Modern
and High Contrast. The order is fixed. A project's colour comes from its
position in the project file, and a vendor's colour from a fixed vendor
order (Anthropic, OpenAI, Google, xAI, Microsoft, Moonshot AI, …), so
filtering never repaints them. Waterfall increases and decreases use the
diverging pair (red `#e34948`, dark blue `#1c5cab`; in dark themes the blue is `#3987e5`, since `#1c5cab` is 2.5:1 on `#1f1f1f`; approved by the owner 2026-11-05) with a written sign;
warnings keep the existing severity colours with icon and text.

### 11.8 Mock-ups and review gate

As in Phase 10 (§3.6 there), the boards are drawn on a Design canvas
before any UI code, with versioned copies in
`docs/plans/mockups/cost-by-project/`:

1. Cost over time with price markers (one series, three series, small
   multiples);
2. Compare (wide, and at 640 px with the drawer);
3. Project: vendor and model bars, the variance waterfall;
4. Billing: draft, issue confirmation, frozen with diff, estimate;
5. Projects editor, including keyboard assignment and validation errors;
6. Empty, partial and error states;
7. VS Code: sidebar grouped by repository, the status bar, the compact
   panel in Dark Modern, Light Modern and High Contrast.

The owner reviews them and their comments are resolved before step 15.9
starts (§14).

**Status: approved by the owner on 2026-11-05, with no change requests.** The
review gate is passed, so UI work (step 15.9 onwards) may start once its
other dependencies are met. The canvas is
**https://claude.ai/artifact/MEYu54PJ19cnSjsgVquWS9**. It is private until
the owner shares it from the page's Share menu; reviewers comment on the
canvas. The versioned copies are in
[mockups/cost-by-project/](mockups/cost-by-project/) (`.dc.html` files
rendered by the canvas, not standalone pages). All numbers on the boards
are sample data. Three boards have tweaks: board 1 switches between one,
three and many series and between the point and price-marker tooltips,
board 4 between the draft, confirm, frozen and export states, and board 7 between Dark Modern, Light Modern and High Contrast.

| Board | File | Shows | Plan |
|---|---|---|---|
| 1 | `Main.dc.html` | Cost over time: Project, Repository, Vendor, Channel, Cost basis and Provider list boxes; filters row, KPI tiles with coverage, three projects as lines with direct labels, a documented (solid) and an observed (dashed) price marker, an unknown week as a gap; a tooltip tweak shows either the point tooltip or the focused price marker's tooltip (unit prices before and after, source, price version); one series as columns with a hatched cap on a partly covered week, plus a separate running total; five series as small multiples with shared or own scale | §11.1, §11.2 |
| 2a | `Compare.dc.html` | Compare table with Columns and Export, indexed line chart, share-of-total bars | §11.3 |
| 2b | `CompareNarrow.dc.html` | 640 px: view select, priority columns, Filters button, details drawer | §11.3, vscode-extension.md §3.5 Layout |
| 3 | `Project.dc.html` | Vendor bars (selectable), models and token types as two charts, August-to-October waterfall with a table, billed-vs-priced finding and per-model gap table | §11.4, §8.4, §6.4 |
| 4 | `Billing.dc.html` | Draft statement with unknown-cost row, totals, markup, fixed line, fixed-rate EUR, provenance; issue confirmation; frozen with "Differs from issued"; export dialog (CSV, JSON or Markdown, session titles optional, preview, Copy and Save); estimate range; issued list | §11.5, §8.5, §8.6 |
| 5 | `Projects.dc.html` | Unassigned repositories first with a Project select per row, alias and capture-rule cases, project cards with member scopes, an exact-tie error inline and in a summary, Save disabled | §11.5, §7, D1 |
| 6 | `States.dc.html` | Loading skeleton with Cancel, two empty states, partial, error, stale price book | §11.5 |
| 7 | `VsCode.dc.html` | Sessions tree grouped by repository, status bar with tooltip, compact Cost over time tab | §11.9 |

Two design changes came out of drawing the boards: a fifth Dashboard tab,
*Project* (§11.1), and the palette correction above (§11.7).

### 11.9 VS Code extension (Copilot only)

- The **Sessions** tree can be grouped by repository as well as by day
  (a view-title toggle with a codicon), with each group's AI Credits.
- The **status bar** shows today's AI Credits for the current workspace's
  repository, with the all-repositories total in its tooltip.
- The panel's Dashboard gets the *Cost over time* and *Compare* tabs.
  Billing and estimates stay in the standalone app at first (D7).
- No unprompted notifications: a price change or a billed-versus-priced
  gap appears as a finding, not a toast.
- Commands sit under the "AI Credits Analyzer" category; new strings go
  through `package.nls.json` and the webview messages module.

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

### 12.4 Usage-scenario tests (end to end)

§12.1 tests the parts, and §11.6 the layout, contrast and keyboard rules.
This section adds tests that drive the **real app** through the main
things a user does with this phase, from the first project to an issued
bill. Each one follows a mock-up board, so the boards are also the test
script.

#### 12.4.1 Harness

- **Standalone app: a new Playwright suite** in `packages/web/e2e/`
  (`npm run test:e2e`). It uses the Playwright already pinned for the UI
  check (1.63.0) and the pre-installed Chromium. Each test starts the
  real server and web build against a **seeded fixture home**:
  - copies of the existing provider test fixtures (Copilot local and
    Agent Host, Claude Code, pi, mitmproxy) arranged as sessions in four
    repositories (three with a git remote, one `local:`), so §4.2's
    resolver runs on real files;
  - a temporary `HOME`, so the project file and statements are written
    there and each test starts clean;
  - a fixture price-book folder (the injectable folder of Phase 13's
    loader), which S5 swaps for an updated one;
  - a **fixed clock** (an environment variable read by the server's
    clock port), so "last 90 days", "this month" and relative dates are
    the same on every run.
- **VS Code extension: new `wdio-vscode-service` specs** in
  `packages/vscode-extension/test/ui/specs/` (step 10.16's harness),
  over a seeded Copilot fixture with sessions in two workspace folders.
- **At every stop** a scenario runs the axe check: in the standalone app in
  light and dark; in VS Code in Dark Modern, Light Modern and High
  Contrast.
- **What a scenario asserts**: figures read from the page (not the API)
  equal the fixture's expected values, written into the test, rounded as
  the UI rounds them (AI Credits 2 decimals); unknown figures read
  "unknown", never "0.00".
- **Test first**: each scenario is written from its board before the UI
  code it drives, fails, and is committed with that step's code (§14).
  The UI check and component tests stay; scenarios don't replace them.

#### 12.4.2 Scenarios

The mock-up canvas (§11.8) carries the same scenarios as blue sticky
notes, one per row of boards, naming the board each one passes through.
When a scenario changes here, its sticky changes in the same commit.

| # | Scenario | Board | Step | Passes when |
|---|---|---|---|---|
| S1 | **First project.** Open the Dashboard with no project file → the "no projects" empty state → *Create project* → assign three repositories with each row's Project select, by keyboard only → Save | 6, 5 | 15.11 | The project appears in the Project list box; its total equals the sum of its three repositories; the file on disk parses against the schema |
| S2 | **One project over time.** Select the project, week buckets, last 90 days → Tab to the price marker (the fixture's is 2026-10-07; the board's sample shows Sep 1) → its tooltip opens → Escape closes it → *View as table* | 1 | 15.9 | Tooltip shows old and new unit prices and the source; the table equals the chart; the week with no priced turns reads "unknown" and is a gap in the line |
| S3 | **Compare.** Select two projects → Compare tab → resize to 640 px → open a row's Details → Escape | 2a, 2b | 15.9 | Table measures equal the fixture; at 640 px only the priority columns show; focus returns to the Details button after Escape |
| S4 | **Inside a project.** Project tab → click Anthropic → its models → choose August and October | 3 | 15.10 | Model bars sum to the vendor's total; usage, price and mix effects add up exactly to the change, in the waterfall and its table |
| S5 | **Bill a month.** Billing → October draft → *Issue statement* → confirm → export CSV and Markdown → swap in the updated price-book folder → reload | 4 | 15.11 | The frozen statement shows the same figures as before the swap and "Differs from issued" with the exact diff; both exports contain no message text; the unknown-cost line is listed, not summed |
| S6 | **Overlapping projects.** In the Projects editor, add the same repository and branch scope to a second project | 5 | 15.11 | The tie error shows inline and in the summary, Save is disabled; removing one member enables it |
| S7 | **Estimate.** Billing → Estimate → 20 planned days, 12-week history | 4 | 15.12 | A p50–p90 range labelled "Estimate", at today's prices, equal to the fixture's expected range; no single number shown |
| S8 | **Captures with no folder.** Provider: mitmproxy only → the Unattributed empty state → add a capture rule for the fixture capture folder | 6, 5 | 15.11 | Those sessions move to the rule's repository and its cost includes them |
| S9 | **VS Code.** Open the Sessions view → *Group by repository* → open the panel's Cost over time tab; the workspace is one of the fixture repositories | 7 | 15.14 | Group totals equal the fixture; the status bar shows today's AI Credits for the workspace's repository and the all-repositories total in its tooltip; axe clean in all three themes |
| S10 | **One answer everywhere.** For one project and month, read the total in the Dashboard, from `GET /api/cost/timeseries` and from MCP `get_project_cost` over stdio | 1 | 15.13 | All three are equal, with the same coverage |

#### 12.4.3 CI

- A new `web-e2e` job in `.github/workflows/ci.yml` runs the standalone
  suite on every PR. It is a **required** check: the suite runs headless
  on fixed fixtures and a fixed clock, so a failure is a real failure.
  It uploads Playwright traces and screenshots when a test fails.
- The extension scenario (S9) joins the existing `extension-ui` job,
  which stays informational (`continue-on-error`, as decided for step
  10.16) until the owner decides otherwise.
- No retries are configured: a flaky scenario is fixed, not re-run.

## 13. Decisions

The owner accepted every recommendation on 2026-11-05. The **Decided**
column is binding; the other options are kept for the record.

| # | Question | Options considered | Decided (2026-11-05) |
|---|---|---|---|
| D1 | Can one turn count in two projects? | (a) exclusive, most specific wins; (b) many-to-many, totals not additive; (c) many-to-many with allocation percentages | **(a)**: billing needs additive totals; percentages can come later |
| D2 | Reporting currency | AI Credits only; USD only; both with the fixed 1 credit = $0.01 rate; plus a user currency per statement | **Both, plus an optional fixed-rate user currency on statements** |
| D3 | Which basis do totals use by default? | preferred (billed → reported → priced); one basis per view | **Preferred, with a per-view switch and per-basis coverage shown** |
| D4 | Do statements include API-equivalent (subscription) cost? | never; opt-in per project; always | **Opt-in per project** |
| D5 | Where does project config live? | local JSON file; app database; per-repo file committed to each repo | **Local JSON file** (§7) |
| D6 | Time zone for day/month buckets | UTC; user time zone | **User time zone for statements** (bills follow the calendar month where the user works), **UTC elsewhere** to match the Dashboard |
| D7 | Which product first? | standalone app; VS Code extension; both | **Standalone app first** (it sees every provider and vendor); the extension gets grouping and the status bar in a later step |
| D8 | How far back must price history go? | from first log on this machine; 12 months; current only | **From 2026-10-01** (revised by the owner on 2026-11-05; first recorded as 2026-01-01), sourced, for GitHub Copilot and the Anthropic, OpenAI and Google APIs; earlier turns price as `unknown` unless the user adds versions |
| D9 | Should observed price changes (§6.4) raise findings? | yes; no | **Yes**, as `inferred` findings on the Dashboard |
| D10 | Estimates in scope now, or after Phase 14? | now (run rate, unit cost); after Phase 14 | **Now**, without cross-model replay; Phase 14 adds "on another model" |
| D11 | When does a billed-vs-priced gap become an observed price change (§6.4)? (decided 2026-11-06) | 5% for 2 weeks; 10% for 2 weeks; 5% for 2 months | **5% for 2 weeks**: billed AI Credits differ from priced by more than 5%, in the same direction, in 2 ISO weeks in a row, each week with at least 20 turns that have both figures |
| D12 | How is the mix effect (§8.4) computed? (decided 2026-11-06) | volume vs. mix split; mix = new or dropped models | **Volume vs. mix split**: usage = change in total tokens × period A's average price per token (per token type, over all models); mix = the per-model usage effects minus that; price as in §8.4. The three add up exactly to the change |
| D13 | Where are a project's markup and fixed lines (seat fees) set? (decided 2026-11-06) | per project; per statement; not yet | **Per project**, in `projects.json` (`rates.markupPercent`, `rates.fixedLines`), edited in the Projects editor; every statement for the project uses them and freezes them |
| D14 | Where is D2's optional fixed-rate user currency set? (decided 2026-11-06) | per project; per statement; not yet | **Per project** (`rates.currency`: a code and a fixed rate per USD); the statement states the rate and keeps AI Credits and USD beside it |
| D15 | Can a period that hasn't ended be issued? (decided 2026-11-06) | only ended periods; any time with a warning | **Only ended periods**: a draft any time; *Issue statement* is disabled, with the reason, until the period's last day has passed in the statement's time zone |

## 14. Implementation steps (TDD, each with an exit criterion)

Steps 15.1–15.4 and 15.8 need no price data and can start now. Steps 15.5
onwards need Phase 13 step 13.2's vendor data (or replace it, see 15.5).
No UI code (15.9 onwards) starts before the mock-ups in 15.8 are approved.

| Step | Work | Exit criterion |
|---|---|---|
| 15.0 | Threat-model rows for the two new write endpoints (D1–D10 already recorded in §13) | Threat model updated Done 2026-11-05, see §14.1 |
| 15.1 | **Workspace capture**: `Session.workspace`, `Turn.startedAt` (and per-turn workspace for Claude Code) in every provider; verify classic VS Code chat's folder source | Each provider's fixture test yields folder, branch and turn times; mitmproxy reports Unattributed with a reason Done 2026-11-05, see §14.1 |
| 15.2 | **RepositoryResolver** + `RemoteUrlNormalizer` | Unit tests of §12.1 pass; no credential in any output (property test) Done 2026-11-05, see §14.1 |
| 15.3 | **ProjectCatalog** + project file schema + `GET/PUT /api/projects`, `GET /api/repositories` | Schema, matching and API tests pass; a bad file gives a config warning Done 2026-11-05, see §14.1 |
| 15.4 | **Attribution in the dataset**: `repositoryKey`/`projectId`/`vendorId`/`channel` on Insights rows; Project, Repository, Vendor and Channel list boxes on the Dashboard; MCP: `list_repositories`, `list_projects`, `list_sessions` filters (§10.1) | Dashboard filters by repository and project; totals match the per-session totals; axe and keyboard tests pass for the new list boxes; the step's MCP tools pass the §10.1.6 tests Done 2026-11-05, see §14.1 |
| 15.5 | **Price book with history**: `PriceVersion` schema, bundled channel files with sources, user versions, `PriceBook` lookup; Phase 13 profiles read their current prices from it; MCP: `get_price_book` | Overlap/boundary/precedence tests pass; every version has a source; Phase 13 tests unchanged; the step's MCP tools pass the §10.1.6 tests Done 2026-11-05, see §14.1 |
| 15.6 | **CostPricer + basis**: `CostFigure` on every turn row; reconciliation figures for Copilot turns; Cost basis list box; MCP: cost basis in `get_session_cost`, `get_cost_rollup`, `get_turn` | Pricing tests pass; unknown never sums as 0; billed vs priced shown per model-month; the step's MCP tools pass the §10.1.6 tests Done 2026-11-06, see §14.1 |
| 15.7 | **Time series, compare, project breakdown** + their endpoints; MCP: `get_repository_cost`, `get_project_cost`, `compare_costs`, the `review_costs` project step | Golden outputs for a fixture dataset across three providers and two projects; the step's MCP tools pass the §10.1.6 tests Done 2026-11-06, see §14.1 |
| 15.8 | **Mock-ups and palette** (§11.7, §11.8): the seven boards on a Design canvas with versioned copies (drawn and approved 2026-11-05); the eight categorical tokens in `theme.css` and `theme-vscode.css` (done 2026-11-05, see §14.1) | Owner approves the boards and their comments are resolved; the dataviz validator passes in light and dark; `theme-contrast.test.ts` covers the new tokens in Dark Modern, Light Modern and High Contrast Done 2026-11-05, see §14.1 |
| 15.9 | **Dashboard tabs: Cost over time and Compare**, with price-change markers (§11.1–§11.3) | Component tests incl. "View as table" and unknown-as-gap; `vitest-axe` clean in three themes; keyboard tests; the UI check (`npm run test:ui`) passes for the new tabs at 600–1600 px in three themes; screenshots of the standalone app at desktop and 360 px widths; the §12.4.1 Playwright harness and fixture home are in place, and scenarios S2 and S3 pass in the `web-e2e` job Done 2026-11-06, see §14.1 |
| 15.10 | **Price changes and variance**: `PriceChangeDetector`, observed-change finding, `VarianceAnalyzer`, Project tab (§11.4); MCP: `explain_cost_change` tool and prompt, `get_price_changes`, `list_findings` kind `price-change` | Effects add up exactly (property test); markers match price-book boundaries; same UI checks as 15.9; the step's MCP tools pass the §10.1.6 tests; scenario S4 passes Done 2026-11-06, see §14.1 |
| 15.11 | **Statements**: builder, freeze, diff, CSV/JSON/Markdown export, Billing tab, Projects editor (§11.5); MCP: `get_statement`, `prepare_statement` prompt | Golden statements; a frozen statement survives a price-book update unchanged and the diff is exact; every project can be assigned by keyboard alone; same UI checks as 15.9; the step's MCP tools pass the §10.1.6 tests; scenarios S1, S5, S6 and S8 pass Done 2026-11-06, see §14.1 |
| 15.12 | **Estimates** + Estimate panel; MCP: `estimate_cost`, `estimate_work` prompt | Forecast range tests on fixture histories; shown as a labelled range, never a single number; the step's MCP tools pass the §10.1.6 tests; scenario S7 passes |
| 15.13 | **MCP, cross-cutting work** (§10.1.4): server instructions for both products, the `toolGroups` option and the extension's tool set, the security tests of §10.1.5 | The §10.1.6 exit criterion over stdio; scenario S10 passes |
| 15.14 | **VS Code extension** (§11.9): group by repository, status bar per workspace repository, the two Dashboard tabs | Extension and manifest tests (category, codicons, l10n keys); UI check passes; manual check list updated; scenario S9 passes in `extension-ui` |
| 15.15 | **Docs**: architecture.md (domain, data flow, API), UserGuide, vscode-extension-guide, vision non-goals, README index | Docs reviewed by the owner |

### 14.1 Step status notes

**15.1 (done 2026-11-05).** `SessionWorkspace` (known: `cwd`, optional
`repositoryHint` and `branch`; unknown: `reason`) is in
`packages/domain/src/workspace.ts`, on `Session.workspace` and, where a turn
ran elsewhere, `Turn.workspace`; `Turn.startedAt` is new too. What each
provider reads, and what was checked:

| Provider | Folder, repository, branch | Turn time | How it was checked |
|---|---|---|---|
| VS Code classic | session store `sessions.cwd`, `repository`, `branch` (the query already selected them; the title fallback already used two) | `turns.timestamp` | Store schema and fixture rows; a real store's values are not checked in this session |
| VS Code Agent Host | catalog payload `data.project.uri`, else `data.workingDirectories[0]` (`file:` URIs only); else the event log's `session.start` `data.context.cwd`. No branch is recorded | each turn's `user.message` timestamp | Both shapes are in the fixtures captured from real VS Code Insights 1.145 and Copilot CLI 1.0.103 logs |
| Claude Code | `cwd` and `gitBranch` on every entry; the session takes the first, a turn its user message's when it differs | the user message's `timestamp` | A real session log on this machine (2026-11-05): every user, assistant, system and attachment entry carries all three, and `cwd` moved between folders of one repository within the session |
| pi | session header `cwd`; pi records no branch | `SessionEntryBase.timestamp` (absent in pre-schema files) | The published schema in the vendored package and its fixture |
| mitmproxy | unknown, with a reason that points to capture rules | HAR `startedDateTime` | Fixtures |

The task "verify classic VS Code chat's folder source" is answered by the
session store's own columns; the `workspaceStorage` fallback from §12.3 is
not needed. The Agent Host event-log reader now keeps `session.start`
events, which it used to drop. The new folder paths are not added to any
MCP output or to the advice export: both pick their fields explicitly
(the §10.1.5 tests that guard this come with step 15.13).

**15.2 (done 2026-11-05).** In `packages/server/src/services/cost-attribution/`:

- `remote-url-normalizer.ts`: a remote URL → key. It drops the scheme,
  user, password or token, and port first; lower-cases the key; removes
  `.git`; keeps GitLab subgroups; and gives Azure DevOps' four forms
  (HTTPS, `ssh.dev.azure.com:v3`, `*.visualstudio.com`,
  `vs-ssh.visualstudio.com:v3`) one `dev.azure.com/<org>/<project>/<repo>`
  key. Local and `file:` remotes give no key. **Found while testing:** an
  `@` left in the path (`user:pass@host` parses as git's `host:path` form)
  would have put `pass` into the key, so any path with an `@` is now
  rejected. The property tests check that no generated credential, in any
  position, reaches a key, and that no key contains an `@`.
- `git-config-remotes.ts`: reads `[remote "<name>"]` `url` entries from a
  config file's text; `origin` is preferred, else the first. It does not
  follow `url.<base>.insteadOf` rewrites or include files.
- `repository-resolver.ts`: §4.2 over a `ReadOnlyFileSystem` port
  (`kindOf`, `readText` with a 256 KiB limit). It follows a `.git` file's
  `gitdir` (worktrees, submodules) and a worktree's `commondir`; a
  remote-less worktree keys by the main checkout's root, so the two merge.
  Results are cached per folder; the branch comes from each workspace.
  `platform/file-system/node-read-only-file-system.ts` is the Node
  implementation (size checked on the open handle).
- Domain: `RepositoryRef` (`key`, `source`: `git-remote`, `git-local`,
  `recorded-repository` or `folder-path`, optional `rootPath`,
  `pathInRepo`, `branch`) and `RepositoryAttribution` (attributed, or
  Unattributed with a reason) in `packages/domain/src/repository.ts`.

Checked on this repository's own checkout: its root and `packages/server`
both resolve to `github.com/raulkivi/agent-cost-analyzer`, so the folder
changes seen in step 15.1's Claude Code log merge into one repository.
Nothing calls the resolver yet; step 15.4 wires it into the dataset.

**15.0 and 15.3 (done 2026-11-05).** Step 15.0's threat-model rows were
written with 15.3, since `PUT /api/projects` is the first new write.

- Domain (`packages/domain/src/projects.ts`): `projectsFileSchema`
  (version 1; projects with members scoped by `path` and `branches`;
  `aliases`; `captureRules`; `channels` as a placeholder for step 15.5),
  `validateProjectsFile` for what a schema can't check (duplicate ids, D1's
  exact ties, a member listed twice, alias chains and self-aliases), and
  `ProjectsState`. `RepositoryList` is in `repository.ts`.
- Server (`services/cost-attribution/`):
  - `ProjectCatalog` loads through a `ProjectStore` and never fails: a
    missing file is empty; a file failing its schema falls back to empty
    with each problem's path; one with only cross-entry problems is kept.
    Saving is strict: any problem rejects the whole file and nothing is
    written.
  - `FileProjectStore` keeps `projects.json` in the app settings folder.
    Reads are limited to 1 MiB; writes go to a 0600 temporary file in the
    same folder and are renamed over the old one.
  - `matchProject` applies §7's rule: the deepest path wins, then a branch
    scope over none, then file order. Branch patterns support `*` (one
    segment), `**` and `?`. Aliases are followed.
  - `RepositoryListService` and `buildRepositoryList` work from session
    summaries only, merge aliased keys, and group Unattributed sessions by
    reason. Unavailable or failing providers are reported, never fatal.
- API: `GET /api/projects`, `PUT /api/projects` (400 with `problems` beside
  `error`), `GET /api/repositories`, and a new optional config warning,
  `projects-file-invalid`. The extension's `ApiService` has no projects yet
  (404) until step 15.14, and these routes aren't in its webview
  allow-list.
- Capture rules were validated but not applied here, because mitmproxy
  sessions didn't carry their capture file's path; step 15.4 applies them.

**15.4 (done 2026-11-05).** `SessionAttributor`
(`services/cost-attribution/session-attributor.ts`) attributes a session,
and each turn by its own folder and model, to a repository
(`RepositoryResolver`, aliases followed), at most one project
(`matchProject`, D1), a vendor and a channel. It reads the projects file
once per dataset.

- **Capture rules apply.** mitmproxy sessions carry
  `Session.capture.filePath` (never in MCP output or the advice export),
  matched by the branch-pattern DP matcher (`*`, `**`, `?`, a leading `~`,
  Windows slashes normalised) and attributed with the new source
  `capture-rule`.
- **Channels** are domain ids in `packages/domain/src/channels.ts`
  (`github-copilot`, `anthropic-api`, `openai-api`, `google-api`,
  `xai-api`, `moonshot-api`). `resolveChannel` gives VS Code
  `github-copilot`, Claude Code `anthropic-api`, and pi and mitmproxy the
  model vendor's API channel; `channels.providers` overrides a provider.
  **Changed from §6.3:** mitmproxy uses the model's vendor, not the
  decoder's, because sessions don't record which decoder ran. The
  per-repository override of §6.3 is not in the file schema yet.
- **Vendor** comes from Phase 13's profiles, read unchanged: a few
  spellings of the model id first (lower case, no `vendor/` prefix, no
  `[1m]`-style tag or date suffix, `x-5-5` as `x-5.5`), then a model
  family only one vendor uses; otherwise unknown with a reason.
- **Insights rows** (session and turn) carry `repositoryKey`, `projectId`,
  `vendorId` and `channel`, each null with a reason when unknown
  (`unattributedReason`, `vendorUnknownReason`, `channelUnknownReason`);
  an Unattributed row has no project. The dataset adds project and vendor
  display names.
- **Dashboard:** the first list-box group is Project, Repository, Vendor
  and Channel, over turn rows (a session that moved between repositories
  counts each turn where it ran), with Unattributed, No project, Unknown
  vendor and Unknown channel selectable, so no cost is dropped. A test
  checks that totals per value add up to the whole and match the
  per-session totals; axe (four themes) and keyboard tests cover the new
  list boxes.
- **Repository list** now uses the attributor (capture rules and aliases
  apply) and gains turn counts, AI Credits with session coverage, and
  provider and date filters.
- **MCP:** `list_repositories`, `list_projects` and `list_sessions`'
  `repository`/`projectId` filters (which use the session's own folder),
  served by `AttributionQueryService`. `local:` and `path:` keys are
  returned as the folder name only, root paths left out, unless
  `includePaths`; local keys are redacted in projects-file problems too. A
  property test checks no output holds a home folder or credential. Two
  local repositories with the same folder name look alike without
  `includePaths`.
- The extension's MCP server keeps its nine tools (attribution is an
  optional dependency) until steps 15.13/15.14; its Dashboard attributes
  repositories, vendors and channels, with every turn under No project.

TDD exceptions: the `channel-resolver`, `repository-key-privacy` and
`ProfileVendorResolver` tests were written first but not run red before
the code; the Dashboard and a11y tests passed on their first run because
the Dashboard renders whatever groups the (already test-driven) model
defines. Not yet: Unattributed reasons in the Dashboard UI (they are in the
rows, the API and MCP); the mock-up's per-value cost figures in the list
boxes; the per-repository channel override.

**15.8 palette (done 2026-11-05).** `theme.css` `:root` has
`--color-series-1` to `-8` (the §11.7 light steps, fixed order), the
waterfall pair `--color-diverging-increase` (`#e34948`) and
`--color-diverging-decrease` (`#1c5cab`), and `--dash-series-1` to `-8`
(`none`). The standalone app has no dark theme, so the dark steps live in
`theme-vscode.css`: `body.vscode-dark` and `body.vscode-high-contrast` take
the §11.7 dark steps as fixed values (never `--vscode-charts-*`);
`body.vscode-high-contrast` also repeats the dashes solid, `7 4`, `2 3`, and
`body.vscode-high-contrast.vscode-high-contrast-light` takes the light
steps back.

- **Found while validating:** `#1c5cab` fails the dark lightness band
  (L 0.48) and is 2.5:1 on `#1f1f1f`, so dark themes use the blue ramp's 400
  step `#3987e5` for decreases (validator: all pass on `#1f1f1f` and
  `#000`). The owner approved this change to §11.7 on 2026-11-05.
- Validator (`validate_palette.js`), light on `#f2f2f3`: lightness, chroma,
  colour-blind separation (worst adjacent ΔE 9.1) and normal vision (19.6)
  pass; contrast is a warning for orange 2.86, aqua 2.52, yellow 1.94 and
  magenta 2.41. Dark on `#1f1f1f`: all pass (ΔE 8.4, normal vision 19.3,
  all ≥ 3:1). On Light Modern `#ffffff` the warning covers aqua, yellow and
  magenta; on High Contrast `#000` all are ≥ 3:1.
- `theme-contrast.test.ts` covers the standalone app, Light Modern, Dark
  Modern and High Contrast: exact order; 3:1 graphics contrast with an
  explicit light-ground allowance (floor 1.9:1) for orange, aqua, yellow
  and magenta only; the diverging pair; dashes; the light High Contrast
  override; no `--vscode-charts-*`; no ninth series. Nothing uses the tokens
  yet; the charts of step 15.9 onwards do.

**15.5 (done 2026-11-05).** Domain (`packages/domain/src/price-book.ts`):

- `PriceVersion` as in §6.1. `currency` is `"USD"` (the tiers are Phase 13's
  `PriceTier`, USD per 1M tokens; AI Credits follow at 1 credit = $0.01),
  `sourceIds` default to `[]` for user versions, and a contract-only
  `scope` names one project or one repository. Checked: real ISO dates,
  `effectiveTo` after `effectiveFrom`, ascending tiers, `promoEndsAt`
  exactly on promo versions.
- `PriceBookEntry` (a version plus its `origin`), `PriceLookup` (known with
  the version, or unknown with a reason), `PriceBookListing`, and
  `findPriceVersionConflicts`, which compares versions per channel, model
  and precedence class (list and promo one class, each contract scope
  another), rejects overlaps and flags gaps.
- The projects file's `channels.priceVersions` now holds `PriceVersion`s;
  `validateProjectsFile` reports duplicate ids, overlapping user versions
  and unknown `scope.projectId`s.

Server (`services/pricing/`):

- A `PriceBookSource` port. `BundledPriceBookSource` reads
  `fixtures/price-book/<channel>.json` and stops startup on bad data (no
  source, an unknown source, a contract version, a duplicate id, an
  overlap, a file named for another channel). `UserPriceBookSource` reads
  the projects file on every lookup. `CompositePriceBookSource` leaves out,
  as a `problem`, a user version that clashes with one already in the book.
- `PriceBook.priceFor(channel, modelId, at, scope?)` uses
  `[effectiveFrom, effectiveTo)` in UTC with §6.1's precedence; otherwise
  unknown with a reason ("before", "between", "from", no model, no
  channel). `newestVersion` gives Phase 13 its prices; `list` serves the
  API and MCP.

Data:

- One channel, `github-copilot`, with 29 versions moved unchanged from the
  Phase 13 profiles. The profiles no longer hold `tiers` or `promoEndsAt`;
  the loader fills them from the newest version, and a model priced in
  both places (or in neither) stops startup. Phase 13's tests and golden
  snapshots are unchanged and pass.
- **History from 2026-10-01** (D8 as revised): the Copilot book is rebuilt
  from the git history of github/docs' `models-and-pricing.yml`. The table
  at 7f63f3a (2026-09-29) was unchanged until 2026-10-02, so its prices
  hold from 2026-10-01. The only price change since is Claude Sonnet 5.5's
  cached input, $0.20 → $0.10 per 1M on 2026-10-07 (eb975b9). Claude Haiku
  5.5 (2026-10-07), Gemini 4 Argon (2026-10-13) and GPT-6.1 Terra
  (2026-10-26) start on the day they were added. Each version cites the
  table pinned at the commit that proves its start, with a quote (30
  versions). Dates are commit dates (UTC); the docs site may have deployed
  later the same day. Turns before 2026-10-01 price as unknown.
- **Nine models removed during October are in the book** (owner,
  2026-11-05), so October turns on them are priced: Claude Opus 4.7,
  Gemini 3.5/3.6 Flash and Kimi K2.7 Code (removed 2026-10-02, 9c7da1a);
  GPT-5 mini, GPT-5.4, GPT-5.4 mini, GPT-5.5 and Gemini 3.7 Flash (removed
  2026-10-19, 4dd188c). Each runs from 2026-10-01 to its removal commit's
  date, citing the table at 7f63f3a and at the removing commit; no price is
  known after it. No Phase 13 profile simulates them, so the bundled-data
  test now requires every profile model to be priced and every other
  Copilot model to have an end date (39 versions in all).
- The Gemini promotions end per GitHub's wording (Flash "through December
  31, 2026": `effectiveTo` 2027-01-01; Argon "until December 1, 2026":
  2026-12-01); no price is known after them.
- **`anthropic-api`** (`fixtures/price-book/anthropic-api.json`): 20 list
  versions for 18 Claude models from 2026-10-01. Each cites Anthropic's
  pricing page plus a dated release note or announcement; the 5-minute
  cache write maps to `cacheWriteUsdPerM` and the 1-hour write to
  `extendedCacheWriteUsdPerM`, as on `github-copilot`. The window's one
  price change, Claude Sonnet 5.5's cache read $0.20 → $0.10 on
  2026-10-07, is a version boundary (00:00 UTC; the time of day isn't
  published). Claude Haiku 5.5 starts at its 2026-10-07 launch with a
  100,000-token prompt-length tier. The 2026-10-01 starts rest on dated
  launch notes, today's page and release notes recording no change in
  between (no archived page could be fetched). Fast mode on Opus 5 and
  Opus 4.8 is sourced only from 2026-11-05; fast-mode cache prices are
  derived from the page's "multipliers apply on top" rule and say so in
  their notes. New model ids not in any Phase 13 profile:
  `claude-mythos-5`, `claude-mythos-5.1`, `claude-opus-4.5`/`4.6`/`4.7`,
  `claude-sonnet-4.5`, `claude-opus-5.5-fast`, `claude-opus-5-fast`.
  Batch, data-residency, priority and cloud-platform prices are not
  modelled.
- **`openai-api`** (`fixtures/price-book/openai-api.json`): 29
  standard-tier versions for 23 OpenAI text and coding models. Each cites
  OpenAI's pricing page (its `.md` version, which carries the long-context
  columns) plus model pages, the prompt-caching guide, the changelog or the
  deprecations page, checked 2026-11-06. GPT-5.6 and later charge cache
  writes at 1.25× input (30 minutes, `cacheWriteUsdPerM`); the 12-hour
  write at 2.5× (`extendedCacheWriteUsdPerM`) starts at the 2026-10-20
  changelog entry (00:00 UTC), the window's one change. Earlier models
  have no cache-write price, and prompts over 272K input tokens use a
  long-context tier for the whole request. GPT-6.1 Sol, GPT-6 Sol, GPT-6
  Luna and GPT-5.6 Sol start 2026-10-01 on dated changelog prices; GPT-5.6
  Sol's $4/$20 is a promotion ending 2026-11-30, with no price after it.
  GPT-5.6 Terra and Luna also start 2026-10-01 (owner's decision,
  2026-11-06): the 2026-07-30 changelog cut them by 20% and 80% without
  stating amounts, today's page gives the amounts, and the changelog
  records no change since, so today's prices are taken as in force since
  that cut; their notes say so. **Every other OpenAI model starts
  2026-11-06**, including GPT-6 Astra and GPT-6.1 Terra, because no dated
  OpenAI source states its amount (launch entries give none, and openai.com's
  announcements refuse automated requests), so October turns on them price
  as unknown. Batch, Flex, Fast, Ultrafast, regional and cloud-platform
  prices, pro models (no cached-input price), `chat-latest` and
  restricted-access models are not modelled.
- **`google-api`** (`fixtures/price-book/google-api.json`): 15 versions
  for 10 Gemini text models at the paid tier's Standard prices. Each cites
  ai.google.dev's pricing page plus a dated release note or model guide,
  checked 2026-11-06. Google's stated introductory prices are promo
  versions followed by the standard price Google gives for after them:
  Gemini 4 Argon from its 2026-10-13 launch through 2026-11-30 ($2/$10,
  then $4/$20 per 1M input/output), and Gemini 3.8 and 3.6 Flash through
  2026-12-31 ($0.75/$3.75, then $1.50/$7.50). `gemini-2.5-pro` bills at
  Gemini 3.8 Flash rates from its 2026-12-01 routing; Gemini 3.1 Pro
  Preview and 2.5 Pro have a 200,000-token prompt-length tier. Only Gemini
  3.8 Flash and 3.5 Flash-Lite are proven from 2026-10-01; the release
  notes carry no prices for the older models and Gemini 3.6 Flash's price
  cut is undated, so those start on 2026-11-06. Gemini 3.7 Flash and 3.5
  Flash have no price on Google's site (deprecated 2026-10-08) and are
  left out. Cache writes have no price (Gemini has no per-token write
  price); explicit-cache storage per hour, Batch/Flex/Priority, audio
  input, the free tier and Vertex AI aren't modelled.
- Boundaries at a stated date are 00:00 UTC on every channel, since no
  vendor publishes a time of day. `xai-api` and `moonshot-api` have no
  file yet, so a lookup there is unknown.

API and MCP: `GET /api/price-book?channel&model&at` (400 on a bad query;
404 in the extension, which has no price book), and `get_price_book`
(read-only, `outputSchema` `PriceBookListing`) in `mcp/pricing-tools.ts`,
registered only when the server has a price book: the standalone app and
its stdio server. The extension's server gets it with step 15.13's
`toolGroups`, so its tools/list stays at nine. A test checks the HTTP
route and the tool agree. The extension build ships `media/price-book`.

TDD exceptions: the six profile files and `github-copilot.json` were
rewritten by a checked script after their data tests failed; the
extension's build copy lists changed with `build.mts`; the
`ApiService.getPriceBook` test followed the route test. Not yet: mapping
provider model ids to price-table ids and the "at today's prices" mode
(both step 15.6); the planned weekly `vendor-prices.yml` (step 13.9) must
diff `fixtures/price-book/github-copilot.json`.

**15.6 (done 2026-11-06).** Domain (`packages/domain/src/cost-figure.ts`):
`CostFigure` as in §5's sketch (known: `amount`, `currency`, `basis`,
priced-only `priceVersionIds` and `apiEquivalent`, optional `estimated` and
`notes`; unknown: `reason`), `TurnCostFigures` (one per basis),
`preferredCostFigure` (billed, else reported, else priced; D3) and
`costFigureFor` (one basis for a view), `CostTotal` and `CostBasisTotals`
(MeasureTotal-style `turns`/`knownTurns`, one amount per currency, `usd`
only at 1 AI Credit = $0.01, `apiEquivalentTurns`, `preferredBasisTurns`,
the price versions used and the conversion text), `buildCostReconciliation`
and `channelCurrency`. `TurnUsage` gains optional `extendedCacheWrite` and
`reportedCostUsd`; `InsightTurnRow` gains `date` (the turn's own time, else
the session's) and `cost`, `InsightSessionRow` `cost`; `SessionCost`,
`CostRollup` and `TurnView` gain the fields of §10.1.2. Every new field on
an existing shape is optional or added by the server everywhere, so older
payloads and Learn mode are unaffected.

- **Bases.** Billed is `TurnUsage.costAiCredits` (Copilot's
  `copilotUsageNanoAiu`; only the VS Code provider records it). Reported is
  pi's `Usage.cost.total`, summed over every usage in the turn and unknown
  if one lacks it; no other provider logs a cost of its own. Priced is
  `CostPricer` (`services/pricing/cost-pricer.ts`).
- **CostPricer** depends on a `PriceLookupPort` (PriceBook's `priceFor` and
  `newestVersion`) and a `PriceModelMapper`, and reuses Phase 13's
  `priceTurn`/`pickTier` (whose input is now any `{ tiers }`), so the
  arithmetic is not duplicated. The time is the turn's `startedAt`, else the
  session start with a note; the turn's project and repository are the
  lookup's `scope`, so a contract price applies where it is scoped. Copilot
  figures are in AI Credits (USD ÷ $0.01), every other channel in USD.
  "At today's prices" (`mode: "today"`) prices at the version in force now,
  else the newest one; it is tested but no view uses it yet (15.7's
  `pricing` argument will).
- **Model ids.** `CandidatePriceModelMapper` tries the spellings step
  15.4's `candidateModelIds` gives (shared, now also turning a display
  name's spaces into hyphens) against the model ids the channel prices
  (`PriceBook.modelIds`): Claude Code's `claude-opus-5-5-20261001` and a
  `[1m]` tag map to `claude-opus-5.5`, `copilot/GPT-6.1-Sol` to
  `gpt-6.1-sol`. No near match is guessed; `<synthetic>` and `unknown` are
  unknown.
- **Cache-write lifetime, per provider.** Where the log splits writes by
  lifetime, the split is used: Claude Code now reads
  `cache_creation.ephemeral_1h_input_tokens` and pi `cacheWrite1h` into
  `extendedCacheWrite`, priced at `extendedCacheWriteUsdPerM` and the rest
  at `cacheWriteUsdPerM`. Otherwise the provider's default applies, with a
  note on the figure: **Claude Code: the 1-hour rate** (the calibration's
  finding 1 and #145: it writes 1-hour caches); **Copilot (VS Code): the
  standard (5-minute) rate**, as the calibration decided for Copilot;
  **pi and mitmproxy: the API's standard rate**. A 1-hour write on a version
  with no 1-hour price (fast-mode Opus 4.8 on Copilot) is unknown with a
  reason, not priced at another rate. A version with no write price
  (`null`, automatic caching) charges writes as input, as Phase 13 does.
- **Unknown, never 0.** Priced is unknown, with the reason, for an unknown
  channel, an unmappable model, no time at all, no version in force, or an
  unknown uncached-input, cache-read, output or cache-write count. One
  exception, exact rather than guessed: both VS Code stores record uncached
  input as input − cached, so with cache writes unknown a version that
  charges writes as plain input still prices the turn. Reasoning tokens are
  part of output in every provider and aren't priced again.
- **Tiers.** The tier is chosen by the request's whole prompt, as Phase
  13's Pricer does, but a turn holds only the sum of its requests. So a
  single-request turn, or one whose whole input stays in the first tier, is
  priced exactly; a several-request turn that crosses a tier threshold is
  unknown with a reason (the providers don't yet carry per-request input on
  `TurnUsage`).
- **Subscriptions.** Claude Code's priced figures carry `apiEquivalent: true`
  and totals count those turns (§5, D4); no statement logic yet.
- **Wiring.** `TurnCostFigureBuilder` adds billed and reported to the
  pricer's figure and holds the per-provider policy (cache-write default,
  API-equivalent, unknown writes inside uncached input). `InsightsService`
  and `AnalysisQueryService` take a `TurnPricing` port and price each
  dataset or session over one `PriceBook.snapshot()`, because the user price
  source reads the projects file on every lookup. The standalone app and its
  stdio MCP server price with the bundled and user book; the extension's
  Dashboard with the bundled book shipped in `media/price-book`; the
  extension's MCP server has no price book until step 15.13, so its priced
  figures are unknown with that reason.
- **Reconciliation.** `buildCostReconciliation` compares, per model and
  month, the Copilot turns with both a billed and a priced AI Credits
  figure (`billedAiCredits`, `pricedAiCredits`, `difference`, `ratio`,
  their price versions) and counts billed turns the book can't price
  (`billedOnlyTurns`), never comparing them as 0. **Where it is shown:** the
  approved mock-ups place the reconciliation table on the Project tab
  (Project.dc.html), which is step 15.10's; in this step it is in
  `get_cost_rollup`'s `reconciliation`, and the domain function is shared so
  that tab can compute it from the Dashboard's rows.
- **Dashboard.** A Cost basis list box joins the first group after Channel,
  as in Main.dc.html: each turn's preferred basis (Billed, Reported,
  Priced), plus Cost unknown so no turn is dropped. A Cost tile shows the
  selection's cost per currency ("0.50 AI Credits + $0.70"), its coverage,
  API-equivalent turns and the 1 AI Credit = $0.01 rule, with a Preferred /
  Billed / Reported / Priced switch for the view (D3). vitest-axe (the
  a11y suite) and keyboard tests cover both.
- **MCP.** `get_session_cost` adds the repository and project (local keys
  redacted to the folder name, §10.1.5), `cost` and a `cost` per top turn;
  `get_cost_rollup` adds `repository`/`projectId` filters (a redacted local
  key matches too), `cost`, the four breakdowns (unknown buckets last, with
  their reasons) and `reconciliation`; `get_turn` adds `cost` and
  `preferredCost`. Descriptions explain the bases and name no provider, so
  the extension's server shares them. `mcp/cost-basis-tools.test.ts` checks
  the schemas with full, partial and no coverage, that each tool agrees with
  the dataset `GET /api/insights` serves, that unknown stays
  `{known: false, reason}`, and that no output holds a local path.

TDD exceptions: `pricer.ts`'s widened parameter type passed its new test at
once (vitest doesn't type-check); `turn-cost-figures.test.ts` and
`insights-service.test.ts`'s pricer test were written before their code but
not run red in between; the Dashboard's list box needed no component change
(the model defines it). Not yet: per-request input on `TurnUsage` (so
several-request turns crossing a tier stay unknown); the "today" mode in a
view (15.7); the reconciliation table in the UI (15.10's Project tab) and
the observed-change finding (15.10); Claude Code fast mode isn't detected (nothing maps a
turn to the `-fast` price ids, so a fast-mode turn prices at standard
rates); mitmproxy's Anthropic decoder doesn't read the 1-hour split; the
extension's MCP server has no price book (15.13).

**15.7 (done 2026-11-06).** Domain (`packages/domain/src/cost-analysis.ts`,
`price-change.ts`): `CostSeries`, `ProjectCost` and `CostComparison` (§10.1.1),
`BasisCoverage` (`turns`/`knownTurns` for preferred, billed, reported and
priced), UTC buckets (`bucketOf`, `bucketsBetween`: a day, an ISO week
`2026-W41` Monday to Sunday, a calendar month, each with inclusive `start`
and `end`), `costInCurrency`, `addCostTotals`, `comparisonPeriod`, and
`documentedPriceChanges` with `PriceChangeMarker`.

- **Cube and builders** (`packages/server/src/services/cost-analysis/`):
  `buildCostCube` turns the Insights dataset (step 15.4's attribution,
  step 15.6's figures) into one flat row per dated turn, joined to its
  session; turns with no date at all are counted as `undatedTurns`, never
  dropped silently. `buildCostSeries`, `buildCostComparison` and
  `buildProjectCost` are pure functions over it (a new analysis is a new
  builder); `buildProjectCost` is the series grouped by the project plus
  its breakdowns, so the two always agree. `CostAnalysisService` reads one
  cube per request through a `CostCubeSource` port and adds the price
  book's versions (markers) and the projects file's names.
- **Choices.** Every bucket in the range is a point: an idle bucket has
  `turns: 0`; a bucket with turns but nothing known has `usd: null` and no
  amounts, the gap §11.2 draws; partial buckets carry their coverage per
  basis. The range is `since`..`until` when given, else the selection's
  first to last date, and lines share it. Each point has a running
  `cumulative` total. Money is per currency (D2) unless `currency: "usd"`
  (1 AI Credit = $0.01, stated in `conversion`); so compare's per-session,
  per-active-day, per-turn, share and change measures are arrays per
  currency, and a change against a period with nothing known is null, not
  "from 0". Share is of the compared ids' total. Output share is output ÷
  (input + output) tokens over turns whose tokens are known. Per session
  and per turn divide by every turn and session in the selection, known
  or not; the coverage beside them says how much is known.
- **Selection.** Sessions are read as every tool reads them (start in
  `since`..`until`, `provider`, `limit` per provider); turns are then
  bucketed and filtered by their own UTC date (D6). A session started
  before `since` is not read, so its later turns are missing; compare reads
  from the start of the comparison period.
- **"Today's prices"** (§6.2): `TurnPricing.snapshot(mode)` and
  `InsightsService.getDataset(filter, { pricing })` price a dataset in
  either mode, so `pricing=today` re-prices every turn at the newest
  version (the Dashboard keeps "as of use").
- **Price-change markers** are the documented changes (§6.4 point 1): the
  boundary between two adjacent versions of one model on one channel in one
  precedence class where a unit price differs (per tier and token type, old
  and new USD per 1M, percentage), dated inside the range, for the
  channel/model pairs whose versions priced a turn in the selection. A
  gap, an end without a successor or a change of sources only is no
  marker. Step 15.10's detector can reuse `documentedPriceChanges`.
- **Privacy.** Repository keys in every output (HTTP and MCP alike) are
  redacted to the folder name for `local:`/`path:` keys (§10.1.5); a
  filter accepts either form. Groups are formed by the full key, so two
  local repositories with one folder name are two lines with the same
  label. Client names and billing codes are not in any output.
- **API.** `GET /api/cost/timeseries` and `GET /api/cost/compare` (§10),
  zod-validated by `cost-query-params.ts` (dates are ISO calendar dates
  only; a repeated parameter is rejected), 400 on a bad query or unknown
  provider, 404 in a product without cost analyses: the extension's
  `ApiService` has none until step 15.14, and the routes aren't in the
  webview RPC method list yet (15.9 adds what its tabs call). **No project
  endpoint**: §10 names none, so project cost over HTTP is the time series
  with `groupBy=project`; `get_project_cost`'s extra breakdowns are MCP
  only for now (step 15.10's Project tab may add an endpoint).
- **MCP** (`mcp/cost-tools.ts`): `get_repository_cost`, `get_project_cost`
  (an unknown project id is a tool error pointing to `list_projects`) and
  `compare_costs`, read-only, with the HTTP response schemas as
  `outputSchema`, registered when `McpServerDeps.costAnalysis` is given
  (the standalone stdio server, which builds it with attribution). The
  argument schemas are the HTTP ones (`cost-query-params.ts`) with
  descriptions in `tool-helpers.ts`. `review_costs` gains the project step
  (§10.1.3), worded "if the list_projects tool is available" because the
  extension's server shares the prompt. The extension's server keeps its
  nine tools until step 15.13.
- **Golden outputs** (`cost-analysis.golden.test.ts`,
  `__golden__/*.json`, fixture in `test-support/cost-analysis-fixture.ts`):
  VS Code (billed), Claude Code (priced, API-equivalent) and pi (reported)
  sessions over the bundled price book, in two projects (portal: two
  repositories; billing: one) plus a remote-less local repository and a
  folder outside any repository, spanning Claude Sonnet 5.5's 2026-10-07
  cache-read cut (a marker on github-copilot and anthropic-api) and OpenAI's
  2026-10-20 extended cache-write price. Seven outputs are committed
  (series by project, repository, vendor and model; the portal project;
  two comparisons) and figures are checked by hand (for example portal's
  October: 1.9 AI Credits billed and $0.0085 priced; at today's prices
  Sonnet's two Copilot turns are 0.79 AI Credits each).
  `mcp/cost-analysis-tools.test.ts` checks the §10.1.6 points: each tool
  parses against its schema with full, partial and no coverage, equals the
  HTTP service's answer for the same query, returns unknown as null with
  coverage, and holds no local path or client name;
  `get_project_cost` gives priced figures with their price versions beside
  billed Copilot ones.

TDD exceptions: `project-cost-builder.test.ts` was written before its code
but not run red on its own; the MCP tool registrations and the two Express
routes were written before their tests (`cost-analysis-tools.test.ts`,
`app.cost.test.ts`), which then passed at once; the golden files were
generated by the first run and checked by hand, with the hand-checked
figures in the same test. Not yet: model ids in `byVendor` and
`byTokenType` are the providers' own (Claude Code's
`claude-sonnet-5-5-20261001` beside Copilot's `claude-sonnet-5.5`), not the
price book's; cost per token type (only token counts per type are given;
the price split comes with 15.10's variance analysis); a user time zone
(UTC only, D6); the indexed (first period = 100) view of §8.2 is left to
the UI; observed price changes (15.10); the extension's tools and routes
(15.13/15.14).

**15.9 (done 2026-11-06).** The Dashboard's *Cost over time* and *Compare*
tabs, in the standalone app.

- **Where.** `InsightsDashboard` shows a view switch (a `SegmentedControl`;
  a *View* `select` below 700 px of the Dashboard's own width) when
  `ProductFeatures.costAnalysis` is on. *Project* and *Billing* follow in
  15.10 and 15.11. The list boxes and current selections are shared.
- **Selections → request** (`lib/cost/cost-scope.ts`). The endpoints filter
  by one grouping and one provider, so: a Project selection is
  `groupBy=project&ids=…`; else a Repository selection is
  `groupBy=repository`; else every project. A selected *No project* or
  *Unattributed* asks for every line and keeps that one (no id names it).
  Exactly one selected provider is `provider`. **Any other selection** (a
  model, a date, a tool, a vendor…) **is not applied** and the tab says so
  ("Not applied here: Model."), rather than showing figures that only look
  filtered. Compare compares the selected values of its *Group by* field
  when there are two or more, else every value still possible under the
  whole selection (so the associative filters narrow the list), up to 20.
- **Cost over time** (`CostOverTimeTab`, board 1): filters in one row
  (range presets, bucket, unit, pricing); KPI tiles for total (with
  coverage), change versus the previous period of the same length, cost per
  active day and coverage, from a second, day-by-day request starting at the
  previous period (the change is unknown when nothing in it is known); one
  series as columns with a hatched cap on partly covered buckets plus a
  separate running-total chart; two to four as lines with a legend and
  direct labels (spread so they never overlap); five or more as small
  multiples with *Shared / Own scale*. An idle bucket is 0; a bucket with
  turns and nothing known is a gap with a dashed *unknown* band and reads
  "unknown" in the tooltip and table. A *Partial data* warning states the
  coverage whenever it is below 100%.
- **Price-change markers.** A hairline at the change date (solid:
  documented; 15.10 adds the dashed observed kind) and an outline tag per
  model and date ("Price · claude-sonnet-5.5 −50%"), grouping the same
  change on several channels. The tag is in the Tab order; its name is its
  visible text (WCAG 2.5.3) and its description the whole change; focus or
  hover opens a tooltip with each channel's old and new unit prices per
  token type, the sources and the price version; Escape closes it. The
  table view lists each change in a row of its own.
- **Compare** (`CompareTab`, boards 2a and 2b): the §8.2 measures with units
  in the headers and a *Selection* row; below 700 px the name, total,
  change and coverage plus a *Details* button per row opening a `Drawer`
  with the rest (Escape closes it and focus returns to the button) and a
  *Columns* disclosure to keep more; the indexed line chart (each line from
  its first known, non-zero bucket = 100); share of total as
  `HorizontalBars`, which gained a `format`.
- **Units (D2).** Requests ask for native currencies (time series) or USD
  (compare); the tabs show every figure in the picked unit through the
  totals' `usd` at 1 AI Credit = $0.01 and state the conversion, so
  switching unit asks nothing again.
- **Colours** (`SeriesPalette`): `--color-series-n` and `--dash-series-n` in
  a fixed order: a project's position in the projects file (so the Insights
  dataset's `projects` now lists **every** project in file order, not only
  the used ones, sorted), a repository's place among the dataset's sorted
  (redacted) keys; No project and Unattributed neutral; no ninth hue.
- **Local repositories** are named by their folder in the tabs and, now, in
  the Repository list box ("scratch (local)"); the redaction moved to the
  domain (`redactRepositoryKey`, `repositoryFolderLabel`).
- **Extension.** The RPC allow-list and the dispatcher carry
  `getCostTimeSeries`/`getCostComparison` (404 from its ApiService); the
  profile's `costAnalysis` is false, so the tabs are hidden. Its tests stay
  green. The UI check turns the tabs on in its harness and answers them with
  the web package's sample data (`test-support/cost-fixture.ts`) to check
  the shared UI at 600–1600 px in Dark Modern, Light Modern and High
  Contrast: 5 new scenarios, all pass.
- **Usage-scenario suite** (§12.4.1): `packages/web/e2e/` with
  `@playwright/test` 1.64.1 (the UI check's Playwright). Each test spawns the
  real server and the web build over a fresh fixture home (Claude Code and pi
  sessions in the fixtures' shapes, copies of the Copilot usage log and a
  mitmproxy capture, in github.com/acme/portal-web, portal-api, billing and
  `local:scratch`, two projects) at a fixed clock: the server's new clock
  port reads `AGENT_COST_ANALYZER_NOW`, and the page's clock is fixed too.
  axe runs in the browser at every stop. **S2 and S3 pass**; the required
  `web-e2e` CI job runs them with `--trace off` and uploads failure
  screenshots. S2 uses the bundled book's documented change, Claude Sonnet
  5.5's cache-read cut on **2026-10-07**, where the board shows a sample
  Sep 1. The browser axe check found two existing defects, fixed here: list
  box values under the 24 px target size, and the chart table's scroll
  area without keyboard access.
- **Screenshots** (sample fixture data, 2x): `docs/images/guide-dashboard-cost-over-time.png`,
  `guide-dashboard-compare.png` (1440 px), `guide-dashboard-cost-over-time-360.png`,
  `guide-dashboard-compare-360.png`, made by `packages/web/e2e/support/screenshots.mts`,
  which also fails on any horizontal page overflow.

Departures from the mock-ups: the view switch has three views until 15.10
and 15.11; the tabs' filters sit above the charts in the right column, with
*Group by* and *Compare with* in Compare's row rather than a left-column box;
the cost basis is the Overview's existing switch (shared, named in the
kicker); the marker tooltip names sources by id (the price book's titles are
not in the marker); no *Export CSV* on Compare yet; the range presets have no
*Custom…* range yet; the observed (dashed) marker is 15.10's.

TDD exceptions: the component and model tests were written before their
code, but the chart, the tabs and the Dashboard wiring were each finished
in one pass, so their tests failed only for the missing module; the S2 and
S3 scenarios were written after the UI they drive (§12.4.1 asks for them
first); `labelPositions`, the HorizontalBars accessible names and the two
axe fixes were changed after the browser check found them, then tested; the
UI check scenarios, the harness's cost answers, the CI job and the
screenshot script have no tests of their own (they are tests). Not yet:
clicking a column or point to select its period (§11.2); vendor split as
stacked columns inside one project (§11.2, left to the Project tab); a
custom date range; Export CSV; the extension's own cost data and tabs
(15.14); the axe check in a dark theme in the standalone app, which has
none; observed price changes (15.10).

**15.10 (done 2026-11-06).** Price changes, price versus usage, and the
Dashboard's *Project* tab. The owner's decisions D11 (observed-change
threshold) and D12 (mix effect) are in §13.

- **Domain.** `observedPriceChangeSchema` (`kind: "observed"`, the first
  week's Monday, channel, the model as logged, `direction` above/below,
  signed `percent` over the run, the `weeks` with billed and priced AI
  Credits and their ratio, the price versions, `confidence: "inferred"`)
  and `priceChangeListSchema` (documented and observed side by side);
  `costVarianceSchema` per currency, model and token type, whose refinement
  refuses effects that don't add up to the change; finding kind
  `price-change`; `CostSeries.observedChanges`. A priced `CostFigure`
  carries `byTokenType` (uncached input, cache read, cache write, output),
  from `priceTurnParts`, which shares its rates with Learn's `priceTurn`
  (Learn's arithmetic is unchanged; the figure's amount still comes from
  `priceTurn`, so earlier figures don't move).
- **`PriceChangeDetector`** (`services/pricing/`): documented changes are
  step 15.7's `documentedPriceChanges`; observed ones group Copilot turns
  with both figures in AI Credits by channel, model and ISO week, and a run
  of weeks in a row more than 5% away from 1 the same way, each with 20+
  such turns, is one change (D11). `PriceChangeFindingDetector` raises each
  as a `medium`, `inferred` finding (`pricing.observed-change`), linked to
  the first session of its first week, with the weeks as evidence; it
  raises nothing on a dataset priced at today's prices (detectors now
  receive the pricing mode). A billing gap is the model's, so cost series
  find observed changes over every turn of the cube and list those for the
  models the selection used.
- **`VarianceAnalyzer`** (`services/cost-analysis/variance-analyzer.ts`): a
  pure function over the cube, priced as of use, per currency (native, or
  all USD). Cells are model × token type with tokens and cost per period;
  unit price = cost ÷ tokens; a cell (or a token type, for the volume
  effect) with no tokens in one period takes the other period's price, so
  a new or dropped model is usage. Mix is the change after volume and
  price, so the three add up by construction; a fast-check property test
  checks it per currency, model and token type. Turns without a priced
  figure (or its split) are `notExplained`, with reasons.
- **API**: `GET /api/cost/variance`, `GET /api/cost/project` (the Project
  tab needs `get_project_cost`'s breakdown over HTTP) and
  `GET /api/price-book/changes`, parsed by the same schemas as MCP. A
  period is `YYYY-MM` or `YYYY-MM-DD..YYYY-MM-DD` (HTTP) or
  `{since, until}` (MCP). The RPC allow-list and the extension's dispatcher
  carry `getProjectCost` and `getCostVariance` (404 there until 15.14).
- **MCP**: `explain_cost_change` (with the cost analyses),
  `get_price_changes` (in the pricing group, with the cost analyses: its
  observed changes read sessions), the `explain_cost_change` prompt
  (registered only with the cost analyses), and `list_findings` names kind
  `price-change`. Each tool is checked against its HTTP twin.
- **Project tab** (`ProjectTab`, board 3): inside the one project the
  Project list box selects (else it says what to select); cost by vendor
  (`HorizontalBars`, click a vendor), the vendor's models and its tokens by
  type as a separate chart; *Why cost changed* with *From*/*To* months
  (default: the range's first and last month) as a `Waterfall` (new chart:
  totals on the axis, effects floating between levels with dashed
  connectors, the diverging pair plus a written sign, a value that rounds
  to zero drawn as no change, "View as table"), what isn't explained, and
  the documented changes between the months; *Reconciliation*: observed
  price changes as findings (severity as text) and billed minus priced per
  model and month from the dataset's Copilot turns. Amounts are asked in
  USD and shown in the picked unit.
- **Observed markers**: Cost over time draws them as dashed hairlines with
  a tag ("Observed · gpt-5.5 +12%"), a description that says inferred, a
  tooltip with the weeks, and a table row of their own.
- **Checks**: S4 passes (with S2 and S3, three runs in a row; the `web-e2e`
  job runs every spec). The UI check gains two Project-tab scenarios: all
  24 combinations pass in Dark Modern, Light Modern and High Contrast at
  600–1600 px, and the whole check passes (309 checks). Screenshots: `docs/images/guide-dashboard-project.png` and
  `guide-dashboard-project-360.png`.
- **Found and fixed by the browser checks**: the selected bar's value was
  4.4:1 in Light Modern (it now takes the full text colour); two stacked
  charts' table buttons were too close (axe target-size; they now have
  labels and space); a token type with nothing in period A put new work
  under mix (S4's fixture, where nothing before October is priced; now
  usage); a float residue showed as a red "+0.00".

Departures from the mock-ups: the vendor bars are blue, not a colour per
vendor; the token-type chart shows tokens, not cost (the variance has the
cost per type, per month); the reconciliation's *Open price book* and
*Show turns* buttons aren't built; the tab follows only the Project and one
Provider selection and names the rest as not applied; the waterfall asks
for USD (one chart) and shows it in the picked unit.

TDD exceptions: the query-parameter schemas, the project model and the
observed findings' pricing-mode test were written with or after their code
in one pass; the API route was renamed to `/api/price-book/changes` after
it was built (§10 names it so); S4 was written after the tab it drives;
the four fixes above were made after the browser checks found them, then
tested; the UI-check scenarios and screenshot script have no tests of their
own. Not yet: clicking a vendor in Cost over time; Export CSV; observed
changes in the extension (15.14).

**15.11 (done 2026-11-06).** Statements, the Billing tab and the Projects
editor. The owner's decisions D13 (markup and fixed lines per project), D14
(the user currency per project) and D15 (only ended periods are issued)
are in §13.

- **Domain.** `Statement` (`statement.ts`): lines per basis, currency,
  channel, model and price version with tokens by type and unit prices
  (priced lines), unknown-cost lines by reason (never summed), excluded
  lines (subscription use, D4), markup per currency, fixed lines, totals
  per currency (the schema refuses a total that isn't lines + markup +
  fixed), the project's own currency at its fixed rate, coverage and
  provenance (app version, price-book hash, projects-file hash, session
  ids and titles). `diffStatements` gives the exact difference per line,
  per total, in the sessions, unknown turns and inputs. Periods are a
  month or a range in a time zone (`parseStatementPeriod`, `localDate`,
  `periodHasEnded`). `exportStatement` writes CSV, JSON and Markdown
  (shared by the server and the export dialog's preview): no message text,
  titles optional, a leading `= + - @` in a CSV field neutralised. Project
  `rates` gain `fixedLines` and `currency`; Insights turn rows and cube rows
  carry the turn's instant `at`.
- **Server** (`services/billing/`): `buildStatement`, pure over the cost
  cube (the preferred basis per turn, turns placed by their day in the
  statement's time zone, D6); `StatementService` (the draft on demand, the
  frozen copy with the re-run and its diff, issuing only an ended period);
  `FileStatementStore` (`data-sources/statements/`) writes
  `statements/<project>/<period>.json` in the settings folder exclusively
  (never overwritten, 0600) after checking the id and key patterns.
  The time zone is the machine's (`Intl`), overridable by
  `createApp({ timeZone })`; the usage-scenario suite uses UTC.
- **API**: `GET /api/statements`, `POST .../issue` (JSON only, 415
  otherwise; `ConflictError` 409 joins the API errors and the RPC
  statuses). RPC: `getStatement`, `issueStatement`, and for the editor
  `getProjects`, `saveProjects`, `getRepositoryList` (all 404 in the
  extension until 15.14). Threat-model rows for the write, the read and the
  RPC write methods.
- **MCP**: `get_statement` (`mcp/billing-tools.ts`, read-only, never
  issues; `includeLines`) and the `prepare_statement` prompt, wired into
  the stdio server over the same statements folder.
- **Billing tab** (`components/billing/BillingTab.tsx`, board 4): project
  and month (the last ended month by default), exact dates, lines, unknown
  cost listed, totals, the own currency, coverage, provenance; *Issue
  statement* behind a confirmation dialog (focus trapped, Escape cancels),
  shown only when the period can be issued, else its reason; *Export…*
  (CSV, JSON or Markdown, a preview, titles optional, Copy or Save);
  *Frozen* and, when the re-run differs, *Differs from issued* with the
  exact diff; the issued periods. With no projects: the "no projects"
  empty state with *Create project*.
- **Projects editor** (`components/projects/ProjectsEditor.tsx`, board 5),
  opened from Billing in place of the Dashboard: repositories without a
  project first, each assigned with a select (keyboard alone, no drag);
  projects with name, client, billing code, markup, fixed lines, own
  currency, subscription use and members (path and branch scopes); capture
  rules with the Unattributed sessions explained; problems inline and in a
  summary (the domain's schema and cross-entry checks together), Save
  disabled while any remain; a new project's id follows its name until
  saved. Back reloads the dataset.
- **Checks**: golden statements and exports over the cost fixture
  (`services/billing/__golden__/`); a frozen statement unchanged after a
  price-book change with the exact diff (service test and S5). S1, S5, S6
  and S8 pass, with S2–S4, three runs in a row; the fixture can start with
  no projects file. The UI check gains Billing, its export dialog and the
  editor (36 combinations), and the whole check passes (345 checks, none
  failing). Screenshots: `guide-dashboard-billing.png`,
  `guide-dashboard-billing-360.png`, `guide-projects-editor.png`.
- **Found and fixed by the checks**: the excluded-line reason doubled its
  punctuation in Markdown; a store test pulled domain sources into the
  server's program (typecheck); muted text in the export dialog was below
  4.5:1 (axe); a local repository showed its full path in the editor.

Departures from the mock-ups: the user currency is set per project in the
editor (D14), not on the Billing tab; the period select offers the last 12
months, no custom range yet; the Estimate panel is 15.12's; the editor is
opened from Billing (*Edit projects*, *Create project*) rather than from a
settings link, has no Import/Export of the file, and no drag and drop;
aliases are not edited there.

TDD exceptions: the file store, the query wrappers and the web API client
were written with their tests in one pass; S1, S5, S6 and S8 were written
after the UI they drive; the fixes above were made after the checks found
them, then tested; the UI-check scenarios, the harness's answers and the
screenshot script have no tests of their own. Not yet: custom statement
ranges in the UI (the API takes them); Import/Export of the projects file;
the extension's statements (15.14).

## 15. Exit criterion

On a machine with Copilot, Claude Code and pi sessions across at least three
repositories grouped into two projects:

- the Dashboard's cost tabs show each repository's and project's cost per month,
  with coverage, and marks every documented price change in the range;
- the Project tab splits one project's cost by vendor and model, and
  explains the change between two months as usage, price and mix effects
  that add up exactly;
- a statement for one project and month can be issued, exported, and still
  shows the same figures after a price-book update, with the diff listed
  separately;
- the same figures are available through the MCP tools (§10.1.6), and
  MCP and the Dashboard agree for every repository and project;
- the ten usage scenarios of §12.4 pass (S1–S8 and S10 in the required
  `web-e2e` job, S9 in `extension-ui`);
- no unknown cost is shown or summed as zero anywhere.
