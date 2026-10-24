# Copilot instructions

Project-specific guidance for GitHub Copilot in this repo. Full context
lives in the docs below — read them before making changes; don't duplicate
their content here.

- [README.md](../README.md) — doc index
- [docs/vision.md](../docs/vision.md) — product scope, non-goals
- [docs/architecture.md](../docs/architecture.md) — system design, guiding
  constraints, engineering practices (TDD + SOLID)
- [docs/implementation-plan.md](../docs/implementation-plan.md) — phase
  order, exit criteria, current default tech choices
- [docs/agentic-coding-explained.md](../docs/agentic-coding-explained.md) —
  domain reference Learn mode is seeded from

## Rules for this repo

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
- Repo status: every phase's code and docs are merged (Phases 0-9.12, the
  standalone app Agent Cost Analyzer; Phase 10, the AI Credits Analyzer
  VS Code extension in `packages/vscode-extension`). Still open: Phase
  9.6's check against a real captured pi session, and the owner's tasks
  before the extension's first release. The per-phase status is in
  `docs/implementation-plan.md`; the extension's progress table is in
  `docs/plans/vscode-extension.md`.

## Architecture diagrams

Maintain Mermaid diagrams in `docs/architecture.md` as a required aid for
system understanding and validation. They're a structural view of the
ontology, not a substitute for precise prose — every important component and
relationship needs a stable name, responsibility, and constraint in the
surrounding text too.

Keep these diagram types current as the architecture evolves:

- **System context** — users, the application, external systems, trust/network boundaries.
- **Container/component** — packages or runtime components, responsibilities, dependencies, data stores.
- **Sequence** — each key end-to-end workflow: call direction, response data, failure paths, async boundaries.
- **Domain model** — entities/value objects, ownership, cardinality, key relationships from the shared schemas.
- **Data-flow** — source files/providers, parsing/normalization stages, API boundaries, UI consumers.

Before completing an architecture-affecting change, validate diagrams
against the implementation and tests:

- Every node maps to a real module, package, service, actor, or external
  dependency — remove stale or speculative nodes.
- Every arrow is directional and labeled with its relationship or payload;
  never leave semantically important dependencies unlabeled.
- Diagrams agree with module boundaries, public API contracts, domain
  schemas, and actual runtime flow — treat disagreement as an architecture
  defect, not harmless drift.
- Key constraints (local-only boundaries, ownership, sync/async behavior,
  unavailable-data behavior, security boundaries, provider extensibility)
  are visible in the diagram or immediately beside it.
- Keep diagrams focused by concern rather than one unreadable graph; update
  the matching explanatory text and tests whenever a relationship or
  invariant changes.

<!-- mermaid-ai-skills:start -->
## Mermaid Diagrams

When the user asks to create, edit, or visualize a diagram, follow the
instructions in `.github/instructions/mermaid.instructions.md`.
<!-- mermaid-ai-skills:end -->
