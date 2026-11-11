# CLAUDE.md

**Last changed:** 2026-11-11 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

Project-specific guidance for working in this repo. Full context lives in
the docs below — read them before making changes; don't duplicate their
content here.

- [README.md](README.md) — doc index
- [docs/vision.md](docs/vision.md) — product scope, non-goals
- [docs/architecture.md](docs/architecture.md) — system design, guiding
  constraints, engineering practices (TDD + SOLID)
- [docs/implementation-plan.md](docs/implementation-plan.md) — phase order,
  exit criteria, current default tech choices
- [docs/agentic-coding-explained.md](docs/agentic-coding-explained.md) —
  domain reference Learn mode is seeded from

## Rules for this repo

- Every new source file starts with the two-line SPDX header (see
  [AGENTS.md](AGENTS.md)); `npm run headers:fix` adds it. Never remove
  copyright headers or `LICENSE` when copying code.
- Every document has a header with a **last changed** date (YYYY-MM-DD)
  and a **source** link, `https://github.com/raulkivi/agent-cost-analyzer`.
  Add the header only when creating a new document or updating an existing
  one (set the date then); never backfill untouched documents.
- Treat the docs above as the source of truth. If an implementation
  decision conflicts with them, update the relevant doc in the same change
  rather than letting it drift.
- Follow `architecture.md`'s numbered constraints and §11.4/§11.5 (TDD,
  SOLID) for any code change — write the failing test first.
- Follow `implementation-plan.md`'s phase order and each phase's exit
  criterion; don't start a later phase's work before its dependencies are
  met.
- Commit all changes to git as soon as a phase's exit criterion is met,
  before starting the next phase.
- After every phase or step is completed (or its status changes), update
  [docs/implementation-plan-gantt.md](docs/implementation-plan-gantt.md)
  in the same change: the phase bars and percentages, Open items, and the
  phase's detail chart.
- Current status lives in
  [docs/implementation-plan-gantt.md](docs/implementation-plan-gantt.md)
  and the per-phase plans in `docs/plans/`
  (progress table: [docs/plans/vscode-extension.md](docs/plans/vscode-extension.md)).
  Do not record status in this file.
- New pre-release UI checks are written as wdio or Playwright specs, never
  as manual checklist rows. A check neither tool can drive needs the
  owner's explicit exception. See
  [docs/plans/release-ui-gate.md](docs/plans/release-ui-gate.md).
