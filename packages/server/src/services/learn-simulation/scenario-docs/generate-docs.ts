import type {
  ScenarioScript,
  VendorProfile,
} from "@agent-cost-analyzer/domain";
import { simulateScenario } from "../simulate-scenario.js";
import { renderSessionSection } from "./render-tables.js";

export const GENERATED_START = "<!-- scenarios:generated:start -->";
export const GENERATED_END = "<!-- scenarios:generated:end -->";
export const ALL_SCENARIOS_FILE = "all-scenarios.md";

export interface ScenarioFile {
  number: number;
  file: string;
  scriptId: string;
}

// The 18 docs and the script each one is generated from.
export const SCENARIO_FILES: ScenarioFile[] = [
  {
    number: 1,
    file: "01-cache-basics-8-turn-session.md",
    scriptId: "cache-basics",
  },
  {
    number: 2,
    file: "02-subagent-own-session.md",
    scriptId: "subagent-session",
  },
  { number: 3, file: "03-context-compaction.md", scriptId: "compaction" },
  { number: 4, file: "04-model-switch.md", scriptId: "model-switch" },
  { number: 5, file: "05-mcp-tool-change.md", scriptId: "mcp-tool-change" },
  { number: 6, file: "06-clear.md", scriptId: "clear" },
  { number: 7, file: "07-rewind.md", scriptId: "rewind" },
  { number: 8, file: "08-session-forking.md", scriptId: "session-forking" },
  {
    number: 9,
    file: "09-cache-ttl-smoke-break.md",
    scriptId: "cache-ttl-smoke-break",
  },
  {
    number: 10,
    file: "10-instructions-edit.md",
    scriptId: "instructions-edit",
  },
  {
    number: 11,
    file: "11-silent-instructions-pullin.md",
    scriptId: "silent-instructions-pullin",
  },
  {
    number: 12,
    file: "12-inline-exploration-bloat.md",
    scriptId: "inline-exploration-bloat",
  },
  {
    number: 13,
    file: "13-cache-ttl-1-hour-breakpoint.md",
    scriptId: "cache-ttl-1-hour-breakpoint",
  },
  {
    number: 14,
    file: "14-cascading-model-switch-then-ttl-lapse.md",
    scriptId: "cascading-model-switch-then-ttl-lapse",
  },
  {
    number: 15,
    file: "15-image-attachment-invalidation.md",
    scriptId: "image-attachment-invalidation",
  },
  {
    number: 16,
    file: "16-reasoning-budget-toggle.md",
    scriptId: "reasoning-budget-toggle",
  },
  {
    number: 17,
    file: "17-session-forking-multi-branch.md",
    scriptId: "session-forking-multi-branch",
  },
  {
    number: 18,
    file: "18-subagent-cheaper-model.md",
    scriptId: "subagent-cheaper-model",
  },
];

export function replaceGeneratedRegion(doc: string, content: string): string {
  const start = doc.indexOf(GENERATED_START);
  const end = doc.indexOf(GENERATED_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `Doc is missing the ${GENERATED_START} / ${GENERATED_END} markers`,
    );
  }
  return `${doc.slice(0, start)}${GENERATED_START}\n${content}\n${doc.slice(end)}`;
}

// A scenario doc as a section of all-scenarios.md: in-page links instead of
// links to the sibling files, no region markers of its own.
function asSection(doc: string, files: ScenarioFile[]): string {
  let section = doc
    .split("\n")
    .filter((line) => line !== GENERATED_START && line !== GENERATED_END)
    .join("\n")
    .trimEnd();
  for (const { file, number } of files) {
    section = section.split(`](${file})`).join(`](#scenario-${number})`);
  }
  const number = /^# Scenario (\d+):/.exec(section)?.[1];
  return section.replace(
    /^# (Scenario \d+:.*)$/m,
    `<a id="scenario-${number}"></a>\n\n## $1`,
  );
}

export interface GenerateInput {
  // file name -> current content, for the 18 docs and all-scenarios.md
  docs: Record<string, string>;
  scripts: ScenarioScript[];
  profile: VendorProfile;
  // The reference model every doc is simulated on (D7).
  modelId: string;
  files?: ScenarioFile[];
}

export function generateScenarioDocs(
  input: GenerateInput,
): Record<string, string> {
  const files = input.files ?? SCENARIO_FILES;
  const model = input.profile.models.find((m) => m.modelId === input.modelId);
  if (model === undefined)
    throw new Error(`Model "${input.modelId}" is not in the profile`);
  const checkedAt =
    input.profile.sources.map((s) => s.checkedAt).sort()[0] ?? "unknown";

  const out: Record<string, string> = {};
  for (const { file, scriptId } of files) {
    const script = input.scripts.find((s) => s.id === scriptId);
    if (script === undefined)
      throw new Error(`No script "${scriptId}" for ${file}`);
    const doc = input.docs[file];
    if (doc === undefined) throw new Error(`Missing doc ${file}`);
    // The reference harness is Claude Code: every doc is written in its terms.
    const session = simulateScenario(script, {
      profile: input.profile,
      modelId: input.modelId,
      harness: "claude-code",
    });
    out[file] = replaceGeneratedRegion(
      doc,
      renderSessionSection(session, {
        referenceModel: model.displayName,
        checkedAt,
      }),
    );
  }

  const allDoc = input.docs[ALL_SCENARIOS_FILE];
  if (allDoc === undefined)
    throw new Error(`Missing doc ${ALL_SCENARIOS_FILE}`);
  const sections = files.map(({ file }) => asSection(out[file]!, files));
  out[ALL_SCENARIOS_FILE] = replaceGeneratedRegion(
    allDoc,
    sections.join("\n\n---\n\n"),
  );
  return out;
}
