import type { ConfigStatus } from "@copilot-cost-analyzer/domain";

// One Setup-view row per config warning (vscode-extension.md D10, step
// 10.6). Pure and free of `vscode`: vscode/vscode-setup-view.ts renders it.
export interface SetupWarningNode {
  kind: "warning";
  // Stable across refreshes (the tree keeps its selection) and unique.
  id: string;
  // The setting its inline Fix action opens.
  settingId: string;
  label: string;
  // Severity as text as well as an icon: never colour alone (§3.5).
  description: "Required" | "Optional";
  icon: "warning" | "info";
  tooltip: string;
  ariaLabel: string;
}

// No nodes at all means "nothing to fix", which is what makes VS Code show
// the view's welcome content.
export function buildSetupTree(status: ConfigStatus | undefined): SetupWarningNode[] {
  return (status?.warnings ?? []).map((warning) => {
    const required = warning.severity === "required";
    const steps = warning.helpSteps.map((step, index) => `${index + 1}. ${step}`).join("\n");
    return {
      kind: "warning",
      id: `${warning.code}:${warning.settingId}`,
      settingId: warning.settingId,
      label: warning.message,
      description: required ? "Required" : "Optional",
      icon: required ? "warning" : "info",
      tooltip: steps === "" ? warning.message : `${warning.message}\n\n${steps}`,
      ariaLabel: `${required ? "Required" : "Optional"}: ${warning.message}`,
    };
  });
}
