# Message to Designer — Design/ folder ready for review (2026-08-10)

Hi — the `Design/` folder has a new handoff package ready for your review before we implement it. Summary below; full detail is in `Design/README.md`.

## What this covers

**Handoff: Session Analyzer — UX fixes (System Prompt Inspector, Advice Export, Tool Inventory, AI Credits)**

This supersedes the earlier `design_handoff_session_analyser_ui` package for these four areas only — that package's other screens (turns table, scrubber, explanation panel, session list) are still valid except where noted below.

## Screens / changes to review

1. **System Prompt Inspector** (full takeover panel)
   - New breadcrumb header (`← Back to session`, session title, "System prompt inspector" title, model tag) to keep context.
   - Removed the redundant color-legend row (per-block description pane already covers it).
   - Raw-text block backgrounds switch to tinted `color-mix()` fills (12%/16%) instead of full-saturation, for readability.
   - Raw XML text now properly indented (2-space step, single-value tags collapse to one line, multi-child tags expand).
   - New **Pretty / Raw** segmented toggle on the raw-text pane — Pretty is the formatted view, Raw is the literal single-line wire text the model receives. Needs a `text` + `rawText` string per prompt block.
   - Structure-nav indent fix: build `padding` as one shorthand so a later `padding` declaration can't reset `padding-left` to 0 (this was a live bug flattening the tree visually).

2. **Advice Export flow**
   - Moves from cramped inline checkboxes/preview in the 280px session-list column to: a small corner checkbox per session card, a trigger bar once ≥1 session is selected, and a dialog explaining exactly what's bundled (never chat text) with a preview toggle and copy action.
   - Dialog needs to warn inline if a selected session hasn't been opened yet (turn detail unavailable) rather than silently dropping it.

3. **Tool inventory row**
   - Replaces two verbose tag pills per row with a compact treatment: tool name, an 8px status dot (filled/outlined), and a bare invocation count — tooltips carry the full label.

4. **Cost → "AI Credits" terminology**
   - Renames "Cost"/`$X.XXXX` to "AI Credits" (`value.toFixed(2)`, no currency symbol) everywhere: turns table header, sparkline title, empty states, export text.
   - Adds a **Cumulative** column to the turns table (running total of AI Credits, renders `—` once a prior turn's credits are unknown).
   - Session list cards show `"{n} turns · {total} AI Credits"` when known for every turn.

## Files in `Design/`
- `README.md` — full handoff spec (source of the summary above)
- `Session Analyser.dc.html` — full mock, all screens/modes (Learn, Analyze, System Prompt Inspector, Advice Export dialog, empty states)
- `styles.css` — static reference copy of design-system tokens
- `SystemPrompt.txt` — reference system-prompt content used in the mock

Note: `Design/` is gitignored (local-only), so please review these directly from the working tree rather than a PR diff.

## Ask
Please review against the current implementation (`SystemPromptInspector.tsx`, `AdviceExportPanel.tsx`, `ToolInventoryPanel.tsx`) and confirm:
- the color-mix tint percentages and hue choices for the prompt-block backgrounds,
- the breadcrumb copy/layout,
- the Pretty/Raw toggle behavior,
before we start implementation.
