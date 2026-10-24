// The ids package.json contributes (vscode-extension.md §3.4); the manifest
// test keeps this list and the contributions in step.
export const COMMAND_IDS = {
  open: "aiCreditsAnalyzer.open",
  refreshSessions: "aiCreditsAnalyzer.refreshSessions",
  openSession: "aiCreditsAnalyzer.openSession",
  openScenario: "aiCreditsAnalyzer.openScenario",
  showToolAudit: "aiCreditsAnalyzer.showToolAudit",
  copyAdviceBundle: "aiCreditsAnalyzer.copyAdviceBundle",
  fixSetting: "aiCreditsAnalyzer.fixSetting",
  openLearnMode: "aiCreditsAnalyzer.openLearnMode",
  openWalkthrough: "aiCreditsAnalyzer.openWalkthrough",
} as const;

export const VIEW_IDS = {
  sessions: "aiCreditsAnalyzer.sessions",
  learn: "aiCreditsAnalyzer.learn",
  setup: "aiCreditsAnalyzer.setup",
} as const;

// VS Code registers `<view id>.focus` for every contributed view: it reveals
// the view and opens its container.
export const FOCUS_SETUP_VIEW_COMMAND = `${VIEW_IDS.setup}.focus`;
