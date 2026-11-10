# MCP Apps Increment 2: owner's checks (Phase 12, task A24)

**Last changed:** 2026-11-11 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

These checks take about 60 minutes. You run the shipped U9 (cost over time), U10 (comparison) and U11 (cost change) views in the two real hosts and confirm the Increment 2 exit criterion ([mcp-apps.md](mcp-apps.md) §8.2). They follow the method of [mcp-apps-a16-checklist.md](mcp-apps-a16-checklist.md). The approved boards are in [mockups/mcp-apps/](mockups/mcp-apps/README.md); your answers of 2026-11-10 are in [mcp-apps.md](mcp-apps.md) §9.1.

Write each answer in the results table (§5). Screenshots go to `docs/plans/mcp-apps-a24-results/`, using the file names in the table. Check them for private repository names, session titles and paths before you commit them; the User Guide and the extension guide reuse them afterwards.

## 0. Prepare (once, 5 minutes)

From the repo root (Node 22.18+, `npm ci` done):

```bash
npm run build                                   # builds packages/mcp-apps/dist/views.html first
cd packages/vscode-extension && npm run package # ai-credits-analyzer-<version>.vsix
code-insiders --install-extension ai-credits-analyzer-<version>.vsix --force
```

Use `code` instead of `code-insiders` if that is what you have. The repo's `install-extension` skill does the same steps. Then run **Developer: Reload Window**.

Or install the Marketplace pre-release: on the extension's page in VS Code, choose **Switch to Pre-Release Version** (0.5.0 or later), then reload. This tests the published package.

You need these on this machine:

- Copilot Chat sessions in at least two repositories, over at least three weeks, for VS Code.
- Claude Code or Copilot sessions in at least two repositories, over at least three weeks, for Claude Desktop.
- For Claude Desktop, at least one project in the standalone app that holds a few sessions. Without one, mark the project checks n/a.
- Ideally a repository with turns that have no cost (for example a model with no price), so the "Unknown" and "Not explained" states appear. If you have none, mark those rows n/a.

Prompts below use `<repo>` and `<repo2>` for repository names as `list_repositories` returns them, and `<project>` for a project id from `list_projects`. Name the tool in the prompt, as in A16. VS Code may show a tool's name with the server's name in front of it.

## 1. VS Code Copilot Chat (inline views)

1. Check that `aiCreditsAnalyzer.mcp.enabled` is on. **MCP: List Servers** → **AI Credits Analyzer** should list **20 tools**.
2. Open Copilot Chat in **Agent** mode. Check that the AI Credits Analyzer tools are enabled in the tools picker.
3. Use the **Light Modern** theme for the first pass (`Ctrl+K Ctrl+T`).

**1.1 U9, repository cost over time.** Ask: *"What did `<repo>` cost over the last 90 days, weekly? Use get_repository_cost."*

- A view appears under the tool call: product mark and name, kicker "Repository cost", the repository name as title, and a line with the period, bucket and pricing.
- Four basis tiles: **Total · preferred basis**, **Billed**, **Reported**, **Priced**. Each money figure shows its unit (AI Credits) and, where only some turns are known, "known for N of M turns". A tile with nothing known reads **Unknown** with a reason, never 0.
- A **Cost per week** chart with a y-axis. The top y-axis label does not touch the left edge, also next to a price-change marker.
- A week with only some turns known is hatched, and a note under the chart says its bar is a floor. An idle week reads "0 turns", not an empty bar.
- Documented price-change markers are solid, observed ones dashed. The key under the chart names both ("documented price change", "observed price change, inferred"), and **Price changes in this range** lists them with a "documented" or "inferred" tag. If your data has none, mark n/a.
- There is **no** top sessions table, no vendor table and no tokens-by-type table: a repository shows none of them (§9.1 answers 2 and 3).
- No currency control appears while all figures are in AI Credits.

**1.2 U9, project in the extension.** Ask: *"What did the project `<project>` cost? Use get_project_cost."* Any id works; the extension has no projects.

- The view is titled **No projects here**, kicker "Project cost".
- It shows the extension's reason as plain text: *AI Credits Analyzer has no projects: projects are edited in the standalone Agent Cost Analyzer app. Every turn is in No project; repositories are listed as usual.*
- Below it: **What to ask instead**, and a line naming the tool's answer (`Unknown project id "…"`). No empty chart.

**1.3 U10, repository comparison.** Ask: *"Which repository costs the most this month compared with last month? Use compare_costs."*

- The title reads "N repositories compared"; the line under it names the period against the previous one, and the pricing.
- The sentence above the table names the unit and the basis ("All money in AI Credits on the preferred basis: billed, then reported, then priced.").
- Rows are sorted most expensive first. Each row has a total with a share bar, a **Change** with an arrow and the written sign (such as "+12% +3.40"), and per session, per active day, per turn and cache hit.
- A row whose previous period had nothing known reads **no earlier figure**, never "from 0" and no percentage.
- A figure with nothing known reads **Unknown**.
- The footer row **Together** shows totals only, no change.
- Hover a row: it highlights. Tab reaches each row's name as a button.

**1.4 U10 → U9, drill-down.** In the table from 1.3, click a repository.

- U9 for that repository opens in place with no new model turn. The kicker reads "Cost comparison › Repository cost", and **Back to comparison** sits above the title with the trail "Cost comparison / `<repo>`".
- The chain stops here: there is no session drill-down from a repository.
- Press **Back to comparison**. The table returns without a new tool call, and **focus returns to the row you opened** (the focus ring is on its name).
- Open a second row using the keyboard only: Tab to a row, Enter to open, Tab to Back, Enter to return.

**1.5 U11, cost change.** Ask: *"Why did the cost of `<repo>` change between 2026-10 and 2026-11? Use explain_cost_change."* Use two months that both have turns.

- The kicker reads "Cost change"; the line under the title says the view always uses the priced basis.
- Tiles: period A, period B, **Change** (signed amount and percent) and **Not explained**.
- **What moved the cost** is a waterfall: period A total, Usage, Price, Mix, period B total. A rise is in your theme's **danger** colour and a fall in its **success** colour, not blue. Each bar carries its sign (+ or the minus sign) in text. The key names "period total", "raises cost" and "lowers cost". The three effects add up to the change.
- **By model** table: costs A and B, change, usage and price effects. Click a model row: it opens to token types, with tokens, unit prices per 1M tokens (A → B) and the price versions. Click again: it closes. No new tool call.
- **Not explained** tile: the value is the count ("3 turns", or "0 turns" if every turn is priced) and the note reads "no price for these turns; not counted as 0". The section below lists the turns per period with their reasons. If you have none, mark n/a.
- **Documented price changes between the periods**: each entry has a "documented" tag. The **Price changes** button is **disabled** with a visible note that the timeline is not available yet (U13 is Increment 3). It does nothing when clicked.
- If you have a repository whose period A has no priced turns, ask for it. The view says period A has no priced figure and shows "no earlier figure" in the **Change** tile, with no waterfall. If you have none, mark n/a.

**1.6 Error states.**

- Ask for a repository that does not exist: *"Use get_repository_cost for `no-such-repo`."* The view shows "Couldn't load the cost over time." with the tool's text as plain text, not an empty chart. The text answer above it is complete.
- With the view from 1.3 open, run **MCP: List Servers** → **AI Credits Analyzer** → **Stop Server**, then click a row. The view shows "Couldn't open `<repo>`" with the cause, **Retry** and **Back to comparison**. Back works. Start the server again. If you cannot do this, mark n/a.

**1.7 Themes.** Repeat a quick look at U9 (1.1), U10 (1.3) and U11 (1.5) in **Dark Modern** and **Dark High Contrast**, and in **Light High Contrast** if you have time. Light High Contrast has no contrast test. Check:

- text, chart marks, hatching and share bars are readable;
- the waterfall's rise and fall read apart in High Contrast, and the written sign is there;
- the dashed (inferred) and solid (documented) markers read apart;
- borders are visible in High Contrast;
- the card background follows the chat (transparent);
- the focus ring shows when you Tab through the view.

**1.7a Record the High Contrast colours.** No contrast test covers Light High Contrast, and the Dark High Contrast success colour is VS Code's default, not a recording. For each of **Dark High Contrast** and **Light High Contrast**:

1. Switch to the theme (**Preferences: Color Theme**).
2. Run **Developer: Generate Color Theme From Current Settings**.
3. Save the opened file as `docs/plans/mcp-apps-a24-results/vscode-hc-dark-theme.jsonc` or `vscode-hc-light-theme.jsonc`.

Automated (step 10.17, G6): `npm run record:host-themes` in `packages/vscode-extension` writes both files, and `host-sets.ts` and the contrast tests read them. No hand step.

**1.8 Narrow width.** Make the chat panel narrow (about 360 px) and look at U9, U10 and U11. Nothing scrolls sideways.

- U9: the chart scales down, labels thin out and the tiles stack.
- U10: the per-session, per-day, per-turn and cache figures move under each row name ("per session … · per active day … · per turn … · cache hit …").
- U11: the cost A and B columns drop out of the model table; the change and the effects stay. The waterfall labels stay readable.
- U11 at about 600 px (a normal-width chat panel): costs A and B are already gone and the Price column is in view without sideways scrolling (owner decision 2026-11-10).

**1.9 Footer.** Every view ends with **Read-only · local logs · v** and the installed version. Nothing in a view asks you to write or run anything, and you can select its text.

## 2. Claude Desktop (inline and fullscreen)

1. Use the same `claude_desktop_config.json` entry as in A16. Quit Claude Desktop fully and restart it. The server should list **22 tools**.
2. Run the prompts of §1 with these differences:
   - Name repositories as `list_repositories` shows them (a local repository by folder name, a remote as `github.com/org/repo`).
   - The product name in the kicker and footer reads **Agent Cost Analyzer**, and the version is the app's.
3. Check light and dark (Settings > Appearance).

**2.1 U9, repository.** As 1.1. Also check the chart in light and dark: bars, hatching and markers read well.

**2.2 U9, project.** Ask: *"What did the project `<project>` cost over the last 90 days? Use get_project_cost."*

- The kicker reads "Project cost". The basis tiles and chart are as for a repository.
- **Cost by vendor, then model**: a vendor row with its models below, in the chosen unit and basis.
- **Tokens by type**: per model.
- **Top sessions**: a table whose titles are buttons. At narrow width, model, start and turns move under the title.
- The standalone product never shows "No projects here" for a project that exists.

**2.3 Two currencies.** If a repository or project has both AI Credits and USD figures:

- The tiles list one line per currency, AI Credits first, then USD with a "$". The sentence under the tiles says "Currencies are never added together."
- A **Currency** control (AI Credits | USD) appears above the chart and switches it. The chart's unit label changes. The choice survives opening a session and coming back.
- In U10, a money cell lists AI Credits first, then USD; **Together** has two totals; the sentence above the table says the two are never added or converted.
- In U11, each currency has its own heading and block, and the **Not explained** tile appears once, in the first block.

If you have no two-currency data, mark n/a.

**2.4 U9 → U1, project session drill-down.** In 2.2, click a top session.

- U1 (session cost) opens in place with no new model turn. The kicker reads "Project cost › Session cost", and **Back to cost over time** sits above the title.
- Press Back. U9 returns without a new tool call, the currency you chose is still selected, and **focus returns to the session row** you opened.

**2.5 U10 → U9 → U1, the full chain.** Ask: *"Compare the cost of my projects this month. Use compare_costs with groupBy project."* Click a project, then a top session.

- Level 1 is the comparison. Level 2 is U9 for the project, kicker "Cost comparison › Project cost", with **Back to comparison**. Level 3 is U1, kicker "Cost comparison › Project cost › Session cost", with a Back control named after the project and a trail naming the path.
- Back from each level returns one level, restores focus to the row you left, and makes no new tool call for the levels you return to.
- If U1 shows **Ask about this session**, press it: the chat receives only `Analyse session <id>`.

**2.6 U10 with no projects.** If you have no projects, ask for the project comparison. The view is titled **No projects here** and says "There are no projects to compare." (the standalone product's wording; the extension's reason shows only in VS Code). If you have projects, mark n/a.

**2.7 U11.** As 1.5, with the same tile, waterfall, model-table, **Not explained** and price-change checks. Also check a project: *"Why did the cost of project `<project>` change between 2026-10 and 2026-11? Use explain_cost_change with groupBy project."* The model table, waterfall and **Not explained** section render as for a repository.

**2.8 Light and dark.** Look at U9, U10 and U11 in light and in dark. In the waterfall, a fall is green in both, a rise is red in both, and neither is blue.

**2.9 Narrow and fullscreen.** Resize the window or the chat column to about 360 px: no sideways scroll, and the narrow layouts of 1.8 apply. Try fullscreen if Claude offers it, and note whether it works for U9 (fullscreen for U9 is a later task, A31).

**2.10 Permission prompts.** Note whether Claude asked for permission when you clicked a row (`get_repository_cost`, `get_project_cost`) or a top session (`get_session_cost`). A16 recorded the answer for the MVP's drill-downs.

**2.11 Footer.** Each view ends with **Read-only · local logs · v** and the app's version.

## 3. Claude Code CLI: text unchanged

1. With the server registered as in A16, ask the same questions as in 1.1, 1.3 and 1.5.
2. The answers are the usual text, and nothing mentions HTML, `ui://` or a view.

## 4. Owner decisions to confirm (mcp-apps.md §9.1)

| # | Decision | Where you see it |
|---|---|---|
| 1 | The error text shows as a state; in the extension, "No projects here" with the reason. | 1.2, 1.6 |
| 2 | No top sessions on a repository; U1 drill-down for projects only. | 1.4, 2.4 |
| 3 | No vendor-then-model breakdown for a repository. | 1.1 |
| 4 | A rise in the danger colour, a fall in the success colour, each with the written sign. | 1.5, 2.8 |
| 5 | Mixed currencies: AI Credits first, then USD with "$"; the header names both. | 2.3 |
| 6 | "no earlier figure" when the earlier period has nothing priced. | 1.3, 1.5 |
| – | **Not explained** tile: "3 turns", "no price for these turns; not counted as 0". | 1.5 |
| – | Period totals in the brand data colour, not the board's blue (A23; the blue failed 3:1 on Claude dark). Confirmed 2026-11-10. | 1.5, 2.8 |
| – | U11's by-model table drops costs A and B from 640 px, so Price fits at about 600 px. | 1.8 |

## 5. Results

| Check | VS Code Copilot Chat | Claude Desktop |
|---|---|---|
| Version (Help > About / About Claude) | | |
| Tool count (20 / 22) | | |
| U9 repository renders: four basis tiles, weekly chart, no sessions table | | |
| U9 y-axis labels clear of the left edge, also beside a marker | | |
| U9 partial week hatched with a "floor" note; idle week "0 turns" | | |
| U9 documented (solid) and inferred (dashed) markers read apart, list tags | | |
| U9 project: vendor then model, tokens by type, top sessions | n/a (no projects) | |
| U9 "No projects here" with the extension's reason, no empty chart | | n/a |
| U9 two currencies: tile lines, currency control, choice survives Back | n/a unless USD data | |
| U10 renders: share bars, signed change, per-measure columns, Together | | |
| U10 "no earlier figure", never "from 0" | | |
| U10 Unknown figure reads Unknown, never 0 | | |
| U10 mixed currencies apart, AI Credits first, Together has two totals | n/a unless USD data | |
| U10 → U9 in place, Back to comparison, focus returns to the row | | |
| U10 → U9 → U1 chain with Back at each level and focus return | n/a (chain stops at U9) | |
| U9 → U1 for a project, Back, focus returns | n/a (no projects) | |
| U10 project comparison with no projects: "No projects here" | extension reason | standalone wording |
| U11 renders: tiles, waterfall adds up, model table opens to token types | | |
| U11 rise in danger colour, fall in success colour, written signs, no blue | | |
| U11 "Not explained" tile "N turns" / "no price for these turns; not counted as 0", reasons listed | | |
| U11 "no earlier figure" when period A has nothing priced | | |
| U11 documented price changes tagged; "Price changes" disabled with a note | | |
| U9–U11 error state shows the tool's text in plain text | | |
| Failed drill-down shows Retry and Back | | |
| Footer "Read-only · local logs · v…" on every view | | |
| Light theme readable (`vscode-light-u9.png`, `claude-light-u10.png`, `claude-light-u11.png`) | | |
| Dark theme readable (`vscode-dark-u10.png`, `claude-dark-u9.png`, `claude-dark-u11.png`) | | |
| Dark High Contrast readable (`vscode-hc-dark-u11.png`) | | n/a |
| Light High Contrast readable (`vscode-hc-light-u11.png`, optional) | | n/a |
| High Contrast colours recorded (1.7a: `vscode-hc-dark-theme.jsonc`, `vscode-hc-light-theme.jsonc`) | | n/a |
| U11 at about 600 px: Price in view, no sideways scroll | | |
| Narrow, about 360 px: no sideways scroll (`vscode-narrow-u10.png`, `claude-narrow-u11.png`) | | |
| U10 narrow: measures move under the row name; U11 narrow: costs A and B drop | | |
| Keyboard: Tab/Enter drill-downs, Back, focus ring visible | | |
| Permission prompts on drill-down calls? | | |
| Fullscreen offered / works | n/a (inline only) | |
| Matches the approved A17b boards (differences?) | | |
| Claude Code CLI: text output unchanged | | |

When every row passes, A24 is done, and with it the Phase 12 Increment 2 exit criterion (§8.2). Report anything that fails, with a screenshot. I'll fix it before the Increment 2 release (extension 0.6.0 / app 0.11.0, §7.3).
