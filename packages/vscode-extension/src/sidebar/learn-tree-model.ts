import type { Session } from "@copilot-cost-analyzer/domain";
import { identityTranslate, type Translate } from "../l10n/localize.js";
import type { MessageNode } from "./sessions-tree-model.js";

// The Learn tree as plain data (step 10.12): the bundled scenarios grouped
// by category, as the Sessions view groups sessions by day, so the panel
// needs no scenario list of its own. Pure and free of `vscode`:
// vscode/vscode-sidebar-views.ts turns these nodes into TreeItems.

export interface ScenarioNode {
  kind: "scenario";
  scenarioId: string;
  label: string;
  description: string;
  tooltip: string;
  ariaLabel: string;
}

export interface CategoryNode {
  kind: "category";
  // The category's name, or "other": stable across refreshes, so the tree
  // keeps its expanded state.
  id: string;
  label: string;
  description: string;
  expanded: boolean;
  children: ScenarioNode[];
}

export type LearnTreeNode = CategoryNode | ScenarioNode | MessageNode;

const OTHER_ID = "other";

function turnCountText(count: number, t: Translate): string {
  return count === 1 ? t("{0} turn", count) : t("{0} turns", count);
}

function toScenarioNode(scenario: Session, category: string, t: Translate): ScenarioNode {
  const cost = scenario.costAiCredits.known
    ? t("{0} AI Credits", scenario.costAiCredits.value.toFixed(2))
    : t("AI Credits unknown");
  const description = t("{0} · {1}", turnCountText(scenario.turnCount, t), cost);
  return {
    kind: "scenario",
    scenarioId: scenario.id,
    label: scenario.title,
    description,
    tooltip: `${scenario.title}\n${category}\n${description}`,
    ariaLabel: t("{0}, {1}, {2}", scenario.title, category, description),
  };
}

// Categories in the order their first scenario comes (the server's own
// order), scenarios in theirs; uncategorised scenarios last, under Other.
// Every group starts expanded: there are few scenarios per category.
export function buildLearnTree(scenarios: Session[], t: Translate = identityTranslate): CategoryNode[] {
  const groups = new Map<string, { label: string; scenarios: Session[] }>();
  const uncategorised: Session[] = [];
  for (const scenario of scenarios) {
    if (!scenario.category) {
      uncategorised.push(scenario);
      continue;
    }
    const group = groups.get(scenario.category) ?? { label: scenario.category, scenarios: [] };
    group.scenarios.push(scenario);
    groups.set(scenario.category, group);
  }
  const ordered = [...groups.entries()].map(([id, group]) => ({ id, ...group }));
  if (uncategorised.length > 0) ordered.push({ id: OTHER_ID, label: t("Other"), scenarios: uncategorised });
  return ordered.map((group) => ({
    kind: "category",
    id: group.id,
    label: group.label,
    description:
      group.scenarios.length === 1 ? t("{0} scenario", 1) : t("{0} scenarios", group.scenarios.length),
    expanded: true,
    children: group.scenarios.map((scenario) => toScenarioNode(scenario, group.label, t)),
  }));
}

// In place of the scenarios when they couldn't be read.
export function learnLoadErrorTree(t: Translate = identityTranslate): MessageNode[] {
  return [{ kind: "message", label: t("Couldn't load the Learn scenarios"), description: t("Refresh to retry."), icon: "error" }];
}
