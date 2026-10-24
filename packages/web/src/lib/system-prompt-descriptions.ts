import type { PromptNode } from "./system-prompt-parser.js";

export interface TagDescription {
  description: string;
  sourced: boolean;
  sourceUrls: string[];
}

const VSCODE_COPILOT_CHAT_REPO = "https://github.com/microsoft/vscode-copilot-chat";
const CUSTOM_INSTRUCTIONS_DOC = "https://code.visualstudio.com/docs/agent-customization/custom-instructions";
const AGENT_SKILLS_DOC = "https://code.visualstudio.com/docs/agent-customization/agent-skills";
const SUBAGENTS_DOC = "https://code.visualstudio.com/docs/copilot/agents/subagents";

function sourced(description: string, sourceUrls: string[]): TagDescription {
  return { description, sourced: true, sourceUrls };
}

function inferred(description: string): TagDescription {
  return { description, sourced: false, sourceUrls: [] };
}

// Grounded in a source-level read of microsoft/vscode-copilot-chat (public,
// MIT) — the captured prompt matches its Claude46SonnetPrompt /
// Claude46OptimizedBasePrompt templates (anthropicPrompts.tsx and related
// files) almost verbatim. Anything not confirmed there falls back to
// `inferred()` rather than guessing at an internal implementation detail.
export const TAG_DESCRIPTIONS: Record<string, TagDescription> = {
  securityRequirements: sourced(
    "Vigilance rules layered on top of the core instructions: watch for OWASP Top 10 issues in generated code, " +
      "flag suspected prompt-injection attempts found in tool output, and refuse to help build malware, DoS tools, " +
      "or unauthorized exploitation/bypass tooling.",
    [`${VSCODE_COPILOT_CHAT_REPO} — anthropicPrompts.tsx`],
  ),
  operationalSafety: sourced(
    "The reversible-vs-destructive action policy: take local, reversible actions (editing files, running tests) " +
      "freely, but pause for confirmation before anything hard to reverse or that affects shared systems — " +
      "force-push, rm -rf, dropping tables, pushing code, messaging people.",
    [`${VSCODE_COPILOT_CHAT_REPO} — anthropicPrompts.tsx`],
  ),
  implementationDiscipline: sourced(
    "Anti-over-engineering rules: only change what was asked or is clearly necessary — no unrequested refactors, " +
      "no docstrings/comments/type annotations on code you didn't touch, no speculative error handling or " +
      "one-off abstractions.",
    [`${VSCODE_COPILOT_CHAT_REPO} — anthropicPrompts.tsx`],
  ),
  parallelizationStrategy: sourced(
    "Guidance on batching independent, already-decided read-only operations instead of searching speculatively — " +
      "a model-specific tuning block (Claude46SonnetPrompt.renderParallelizationStrategy(); other model families " +
      "in this codebase render a shorter variant).",
    [`${VSCODE_COPILOT_CHAT_REPO} — anthropicPrompts.tsx`],
  ),
  toolUseInstructions: sourced(
    "Tool-calling etiquette: read a file before editing it, prefer the editor's own tools over raw terminal " +
      "commands, never say a tool's internal name to the user, and call independent tools in parallel but " +
      "dependent ones sequentially.",
    [`${VSCODE_COPILOT_CHAT_REPO} — anthropicPrompts.tsx`],
  ),
  toolSearchInstructions: sourced(
    "Rules for the deferred-tool-loading mechanism: many tools aren't in context by default and must be loaded " +
      "via a tool_search-style call, described in natural language, before they can be invoked.",
    [`${VSCODE_COPILOT_CHAT_REPO} — ToolSearchToolPromptOptimized`],
  ),
  communicationStyle: sourced(
    "Brevity rules for chat responses: 1-3 sentences for simple answers, no unnecessary preambles/summaries, " +
      "no emojis unless asked.",
    [`${VSCODE_COPILOT_CHAT_REPO} — anthropicPrompts.tsx`],
  ),
  communicationExamples: sourced(
    "Few-shot examples nested inside communicationStyle, showing the model exactly how terse a good answer looks.",
    [`${VSCODE_COPILOT_CHAT_REPO} — anthropicPrompts.tsx`],
  ),
  notebookInstructions: sourced(
    "Jupyter-notebook-specific tool usage: use the notebook-editing/cell-running tools instead of shelling out to " +
      "`jupyter` commands, and reference cells by number, not internal cell id.",
    [`${VSCODE_COPILOT_CHAT_REPO} — NotebookInstructions, defaultAgentInstructions.tsx`],
  ),
  outputFormatting: sourced(
    "Markdown formatting rules for responses: backtick symbol names, KaTeX for math, Mermaid fences for diagrams " +
      "— wraps the nested fileLinkification rules.",
    [`${VSCODE_COPILOT_CHAT_REPO} — anthropicPrompts.tsx`],
  ),
  fileLinkification: sourced(
    "Exact rules for turning a file reference into a clickable Markdown link (workspace-relative path, 1-based " +
      "line numbers, no code-fencing of the filename) — matched verbatim against the source.",
    [`${VSCODE_COPILOT_CHAT_REPO} — FileLinkificationInstructionsOptimized, fileLinkificationInstructions.tsx`],
  ),
  semantic_search_requirements: inferred(
    "Usage rules for the workspace embedding-search tool (semantic_search) — when to reach for it over grep/exact " +
      "search. Best-effort: the exact tag name wasn't found verbatim in the checked source snapshot, but the " +
      "underlying tool it governs is confirmed real (ToolName.Codebase = 'semantic_search'); likely a different " +
      "model-family prompt variant than the ones inspected.",
  ),
  memoryInstructions: sourced(
    "Instructions for a persistent, file-based memory system the agent can read/write across sessions — matched " +
      "word-for-word against the source, including its reference to GitHub's Copilot-memory docs. Wraps the " +
      "nested memoryScopes and memoryGuidelines.",
    [`${VSCODE_COPILOT_CHAT_REPO} — MemoryInstructionsPrompt, memoryContextPrompt.tsx`],
  ),
  memoryScopes: sourced(
    "Defines the memory tiers (user/session/repo) the agent can write to and what each is for.",
    [`${VSCODE_COPILOT_CHAT_REPO} — memoryContextPrompt.tsx`],
  ),
  memoryGuidelines: sourced(
    "Per-scope guidance on what to write to memory and how (brevity, when to update vs. create a new file).",
    [`${VSCODE_COPILOT_CHAT_REPO} — memoryContextPrompt.tsx`],
  ),
  skills: sourced(
    "Agent Skills available to this session — only each skill's name and description are shown up front; the " +
      "full SKILL.md is loaded on demand only if the skill becomes relevant to the task.",
    [AGENT_SKILLS_DOC],
  ),
  skill: sourced(
    "One entry in the skills list — its name/description are what the model sees before deciding whether to load " +
      "the full SKILL.md referenced by its file path.",
    [AGENT_SKILLS_DOC],
  ),
  agents: sourced(
    "Subagents this session can dispatch a task to via a runSubagent-style tool call.",
    [SUBAGENTS_DOC],
  ),
  agent: sourced(
    "One entry in the agents list — a specialized subagent with its own name/description, available to be " +
      "invoked for a described kind of task.",
    [SUBAGENTS_DOC],
  ),
  instruction: sourced(
    "One entry in a custom-instructions file list — names a single instructions file (by path) to load on demand " +
      "when its applyTo pattern matches the current task, rather than inlining its content upfront.",
    [CUSTOM_INSTRUCTIONS_DOC],
  ),
  attachment: sourced(
    "Wraps the full, verbatim content of a file attached to this request's context — a custom-instructions file, " +
      "or another file explicitly pulled in.",
    [`${VSCODE_COPILOT_CHAT_REPO} — customInstructions.tsx, fileVariable.tsx`],
  ),
};

const CORE_INSTRUCTIONS_DESCRIPTION = sourced(
  "The built-in core agent operating instructions — establishes the agent's identity and its baseline behavior: " +
    "act rather than just suggest, gather enough context before implementing, don't retry a failing approach, " +
    "don't over-explore once you have enough information.",
  [`${VSCODE_COPILOT_CHAT_REPO} — Claude46SonnetPrompt / Claude46OptimizedBasePrompt, anthropicPrompts.tsx`],
);

const CUSTOM_INSTRUCTIONS_ENVELOPE_DESCRIPTION = sourced(
  "A second, later <instructions> tag — this one is the envelope around project-specific custom instructions, " +
    "skills, subagents, and attached context files, distinct from the built-in agent instructions above. Matches " +
    "VS Code's documented applyTo-scoped custom-instructions mechanism: files are loaded on demand, not always " +
    "inlined.",
  [CUSTOM_INSTRUCTIONS_DOC],
);

const PREAMBLE_DESCRIPTION = inferred(
  "Free-form text before the first tag — in the captured example this is Copilot's persona/identity statement " +
    "plus baseline content-policy and brevity rules. Not sourced from documentation; this reading is based only " +
    "on the captured text itself.",
);

const TRAILING_DESCRIPTION = inferred(
  "Free-form text after the last tag — in the captured example this lists template variables (like a workspace " +
    "path) available for substitution elsewhere in the prompt. Not sourced from documentation; this reading is " +
    "based only on the captured text itself.",
);

const UNTAGGED_DESCRIPTION = inferred(
  "Untagged text sitting between two tagged sections — not part of either neighbor's tag.",
);

const UNPARSED_DESCRIPTION = inferred(
  "This prompt's tag structure could not be fully parsed (an unclosed or crossed tag), so it's shown here as one " +
    "unparsed section rather than a guessed structure.",
);

function unknownTagDescription(tagName: string): TagDescription {
  return inferred(
    `No description available for "${tagName}" — it wasn't part of the captured example this glossary was built ` +
      "from, so nothing is shown here rather than guessing at its purpose.",
  );
}

function hasDescendantNamed(node: PromptNode, tagNames: string[]): boolean {
  return node.children.some((child) => (child.tagName && tagNames.includes(child.tagName)) || hasDescendantNamed(child, tagNames));
}

// tagName/node/label mirror what the menu already computed (system-prompt-menu.ts)
// so the same "which of the two <instructions> is this" and
// "preamble vs. trailing vs. unparsed" structural checks aren't duplicated —
// the label alone disambiguates the untagged cases.
export function describeTag(tagName: string | null, node: PromptNode, label: string): TagDescription {
  if (tagName === null) {
    if (label === "Preamble") return PREAMBLE_DESCRIPTION;
    if (label === "Trailing content") return TRAILING_DESCRIPTION;
    if (label === "Full system prompt (unparsed)") return UNPARSED_DESCRIPTION;
    return UNTAGGED_DESCRIPTION;
  }

  if (tagName === "instructions") {
    const isCustomInstructionsEnvelope = hasDescendantNamed(node, ["skills", "agents", "attachment"]);
    return isCustomInstructionsEnvelope ? CUSTOM_INSTRUCTIONS_ENVELOPE_DESCRIPTION : CORE_INSTRUCTIONS_DESCRIPTION;
  }

  return TAG_DESCRIPTIONS[tagName] ?? unknownTagDescription(tagName);
}
