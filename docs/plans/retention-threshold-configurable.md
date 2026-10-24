# Make the retention threshold configurable

## Context

`docs/architecture.md` §13 explicitly lists as an open question: "Whether
the 200-session retention minimum (constraint 10) should stay a hard-coded
constant in `config-check`, or become an app-level configurable threshold."
Today `MIN_RETAINED_SESSION_LOGS = 200` is hard-coded in
`packages/server/src/services/config-check/config-check.ts` and drives the
`retention-too-low` `ConfigWarning`. This work resolves that open question:
the threshold becomes a user-settable, persisted value, defaulting to 200
when never overridden.

Per the user's choice (via AskUserQuestion), the control is an
**always-visible numeric input in `AppHeader`, next to the "Config"
button** — visible in both Learn and Analyze mode, regardless of whether a
`retention-too-low` warning is currently showing. It's backed by a new
`PUT /api/config/retention-threshold` endpoint, persisted in the app's own
`settings.json` (the same file/dir that already stores `activeProviderId`),
never touching VS Code's own `settings.json` (read-only, per constraint 1/7).

This repo is strict TDD (architecture.md §11.4) — every step below writes
the failing test first. Follow SOLID/CUPID (§11.5): extend existing small
modules rather than inventing new ones.

## Design decisions

- **Domain**: `ConfigStatus` gains a new required field
  `minRetainedSessionLogsThreshold: number` — the *effective* threshold in
  force (persisted override, or 200 by default). This is the single source
  of truth both the warning's `recommendedValue` and the header control read
  from — no second endpoint needed just to display the current value.
- **Persistence**: extend the existing `app-settings.ts` (single
  `settings.json`, the one file this app ever writes — architecture.md
  §11.2) rather than adding a new module. Add
  `readMinRetainedSessionLogsThreshold`/`writeMinRetainedSessionLogsThreshold`,
  following the exact shape of `readActiveProviderId`/`writeActiveProviderId`
  (missing/corrupt file → `undefined`, never throws).
  - **Required fix, not optional**: today's `writeActiveProviderId`
    overwrites the whole file (`writeFileSync(..., { activeProviderId })`)
    instead of merging. With a second key this would silently erase
    whichever key wasn't just written. Both writers must read-merge-write
    through a shared private helper. This must ship as part of this change.
- **Default ownership**: `config-check.ts` keeps sole ownership of the `200`
  default (`MIN_RETAINED_SESSION_LOGS`). `app-settings.ts` returns
  `undefined` when nothing is persisted; `CheckConfigOptions` gains an
  optional `minRetainedSessionLogsThreshold`, and `checkConfig` computes
  `options.minRetainedSessionLogsThreshold ?? MIN_RETAINED_SESSION_LOGS`.
  This mirrors how `settingsPath` resolution is already split between
  `app.ts` (boot-time resolution) and `config-check.ts` (fallback logic).
- **Validation**: positive-integer validation lives only in the `PUT` route
  handler (mirrors `PUT /api/log-providers/active`); the write helper trusts
  its caller, same as `writeActiveProviderId` today.
- **Route**: `PUT /api/config/retention-threshold` with body `{ value:
  number }`, returns the fresh full `ConfigStatus` (mirrors `PUT
  /api/log-providers/active` returning fresh `LogProviderStatus`) — one
  response updates both the header control and the warning banner, no extra
  re-fetch.
- **Frontend state**: a local `useState` in `App.tsx` (page chrome, same
  tier as `showConfigBanner`), not `session-store` — this isn't
  "what's selected" state.
- **Commit behavior**: the header input commits on blur (uncontrolled via
  `defaultValue`), not per-keystroke — avoids one PUT per digit typed.

## Implementation steps (TDD order)

### 1. Domain — `packages/domain/src/config-status.ts` (+ `.test.ts`)
- Add a failing test asserting the schema rejects a status missing the new
  field; update the two existing sample fixtures to include
  `minRetainedSessionLogsThreshold: 200` so they keep passing once required.
- Add `minRetainedSessionLogsThreshold: z.number()` to `configStatusSchema`
  (not nullable — always a concrete effective number, unlike the nullable
  `maxRetainedSessionLogs` which reflects VS Code's own possibly-unset
  setting).

### 2. Server persistence — `packages/server/src/data-sources/log-providers/app-settings.ts` (+ `.test.ts`)
- Failing tests first: `readMinRetainedSessionLogsThreshold` returns
  `undefined` when no file exists; round-trips a written value; degrades to
  `undefined` on corrupt JSON or a missing/non-number key; auto-creates the
  settings dir; **a coexistence test** — writing `activeProviderId` then the
  threshold (and vice versa) round-trips both keys independently (this test
  is red against the current overwrite-on-write implementation and proves
  the merge fix is needed).
- Implement: extend `AppSettingsFileShape` with `minRetainedSessionLogsThreshold?:
  number`; add a private read-merge-write helper used by both
  `writeActiveProviderId` (refactored to merge) and the new
  `writeMinRetainedSessionLogsThreshold`; add
  `readMinRetainedSessionLogsThreshold`.

### 3. `config-check.ts` (+ `.test.ts`)
- Failing tests: custom threshold > current value → warns with that
  threshold as `recommendedValue`; custom threshold ≤ current value → no
  warning; no injected threshold → falls back to 200 (existing tests
  continue to cover this); `ConfigStatus.minRetainedSessionLogsThreshold` is
  present and correct in all cases, including the zero-warnings case and the
  `settings-not-found` branch.
- Implement: add `minRetainedSessionLogsThreshold?: number` to
  `CheckConfigOptions`; compute the effective threshold once near the top of
  `checkConfig`; thread it into `buildRetentionTooLowWarning` (replacing the
  hard-coded constant in its `recommendedValue`/message/helpSteps) and into
  the returned `ConfigStatus` unconditionally.

### 4. `app.ts` + `app.test.ts`
- Failing tests (new `describe` block near the existing `GET
  /api/config/status` / `PUT /api/log-providers/active` blocks, using the
  same `appSettingsDir` temp-dir DI pattern already in `app.test.ts`):
  default-200 on fresh dir; `PUT` with `{ value: 300 }` returns updated
  `ConfigStatus`; persists across a fresh `createApp` instance with the same
  `appSettingsDir`; 4xx on missing/non-number/zero/negative/non-integer
  `value`.
- Implement: `GET /api/config/status` reads
  `readMinRetainedSessionLogsThreshold(resolvedAppSettingsDir)` and passes it
  into `checkConfig`; new `app.put("/api/config/retention-threshold", ...)`
  validates, calls `writeMinRetainedSessionLogsThreshold`, returns a fresh
  `checkConfig(...)` result.

### 5. Web API client — `packages/web/src/api-client/config-status.ts` (+ `.test.ts`)
- Failing tests mirroring `log-providers.test.ts`'s PUT tests (fetch called
  with the right URL/method/body; rejects on non-ok response).
- Implement `updateRetentionThreshold(value: number): Promise<ConfigStatus>`
  via the existing `putJson` helper (already imported for `getJson` in this
  file) — `putJson<ConfigStatus>("/api/config/retention-threshold", { value })`.

### 6. `AppHeader.tsx` (+ `.test.tsx`)
- Failing tests: control renders in Learn mode (not mode-gated); renders
  both when `hasConfigWarnings` is true and false (not warning-gated);
  change handler fires with the new numeric value on blur; control is absent
  when the new props aren't supplied (keeps them optional, no other call
  site needs updates).
- Implement: optional props `minRetainedSessionLogsThreshold?: number`,
  `onRetentionThresholdChange?: (value: number) => void`; render a labeled
  numeric `<input>` (matching the existing provider-`<select>`'s
  `<label><span className="text-muted">...</span>...</label>` idiom),
  positioned immediately before the Config button/Tag, rendered
  unconditionally (outside both the `mode === "analyze"` and
  `hasConfigWarnings` gates) whenever both props are supplied. Use
  `defaultValue` + `onBlur` (commit-on-blur, validated to a positive
  integer before calling the handler), not `value` + `onChange`.

### 7. `App.tsx` (+ `.test.tsx`)
- Failing tests: header shows the fetched threshold on load; changing it
  triggers the PUT and updates both the header value and warning state from
  the response (extend the test file's `fakeFetch`/`cleanConfigStatus`
  fixtures to include the new field and a `PUT
  /api/config/retention-threshold` branch).
- Implement: `const [retentionThreshold, setRetentionThreshold] =
  useState<number | undefined>(undefined)`; set it in the existing
  `fetchConfigStatus()` effect; add `handleRetentionThresholdChange(value)`
  calling `updateRetentionThreshold(value)` and updating both
  `configWarnings` and `retentionThreshold` from the response; pass both
  down into `<AppHeader />`.
- After this step: run the full `packages/web` suite, `tsc --noEmit`, and
  `vite build` (the new required `ConfigStatus` field can surface type drift
  elsewhere).

### 8. Docs
- `architecture.md` §5: add `minRetainedSessionLogsThreshold` to the
  `ConfigStatus` snippet.
- `architecture.md` §8: add the new `PUT /api/config/retention-threshold`
  row; fix the section's stale "no mutation endpoints" framing (already
  contradicted by the existing log-provider PUT).
- `architecture.md` §13: move the "200-session retention minimum... hard-coded
  vs. configurable" bullet from open questions to resolved, recording the
  decision (persisted alongside `activeProviderId`, defaults to 200,
  surfaced as an always-visible `AppHeader` control, backed by
  `GET`/`PUT /api/config/retention-threshold`).
- `implementation-plan.md`: append a dated status addendum to Phase 5 (the
  phase that originally built the hard-coded retention check) recording what
  shipped — field name, the two persistence functions, the two
  routes/route-changes, the `AppHeader` placement — at the level of detail
  Phase 5/8.5's existing status notes use, rather than inventing a new phase
  number for what is explicitly "Phase 5, revisited."

## Verification

- `npm test -w packages/domain`, `npm test -w packages/server`, `npm test -w
  packages/web` all green (run the server suite in full after step 2, since
  the merge-write refactor touches shared persistence code the log-provider
  tests also exercise).
- `tsc --noEmit` and `vite build` clean (new required domain field).
- Manual/browser check (per this repo's established pattern of verifying
  against real local data): start the app, confirm the header shows "200" by
  default next to Config in both Learn and Analyze mode; change it to a
  custom value (e.g. 100 or 300) and confirm via `GET /api/config/status`
  (or the banner, if the current real `maxRetainedSessionLogs` straddles the
  new threshold) that the change persisted and the warning
  present/absent-ness updates accordingly; restart the server and confirm
  the custom value survives (reads from the persisted `settings.json`).
