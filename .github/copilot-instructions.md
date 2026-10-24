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
- Repo status: Phase 0 (repo scaffolding) and Phase 1 (domain model &
  schema package) complete — npm workspaces with `packages/domain` (zod
  schemas + types for every architecture.md §5 shape), `packages/server`
  (Express health check), `packages/web` (Vite + React), Vitest wired with
  TDD-first tests. Phase 2 (Learn mode) is next.

## Architecture diagrams

Use Mermaid diagrams in `docs/architecture.md` as a required aid for system
understanding and architectural validation. Diagrams are a structural view of
the ontology, not a replacement for precise prose: every important component
and relationship must also have a stable name, responsibility, and constraint
in the surrounding documentation.

Keep these diagram types current whenever the affected architecture changes:

- **System context diagram** — users, the application, external systems, and
  trust or network boundaries.
- **Container/component diagram** — packages or deployable/runtime components,
  their responsibilities, dependencies, and data stores.
- **Sequence diagram** — each important end-to-end workflow, including the
  direction of calls, response data, failure paths, and asynchronous
  boundaries.
- **Domain model diagram** — domain entities/value objects, ownership,
  cardinality, and key relationships represented by the shared schemas.
- **Data-flow diagram** — source files or providers, parsing/normalization
  stages, API boundaries, and the UI consumers of normalized data.

Before completing an architecture-affecting change, validate the diagrams
against the implementation and tests:

- Every diagram node maps to a real module, package, service, actor, or
  external dependency; remove stale or speculative nodes.
- Every arrow is directional and labeled with its relationship or payload;
  do not use unlabeled arrows for semantically important dependencies.
- The diagrams agree with module boundaries, public API contracts, domain
  schemas, and the actual runtime flow. Treat disagreement as an architecture
  defect to resolve, not as harmless documentation drift.
- Important constraints are visible either in the diagram or immediately
  beside it: local-only boundaries, ownership, sync/async behavior,
  unavailable-data behavior, security boundaries, and provider extensibility.
- Keep diagrams focused by concern rather than creating one unreadable graph.
  Update the corresponding explanatory text and tests when a relationship or
  invariant changes.

<!-- mermaid-ai-skills:start -->
## Mermaid Diagrams

When the user asks to create, edit, or visualize a diagram, follow the
instructions in `.github/instructions/mermaid.instructions.md`.
<!-- mermaid-ai-skills:end -->
