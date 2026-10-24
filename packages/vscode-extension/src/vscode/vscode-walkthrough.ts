import type { WalkthroughLauncher } from "../onboarding/walkthrough-offer.js";

// The id package.json contributes under `walkthroughs`.
const WALKTHROUGH_ID = "aiCreditsAnalyzer.getStarted";

// How workbench.action.openWalkthrough names a contributed walkthrough.
export function walkthroughId(extensionId: string): string {
  return `${extensionId}#${WALKTHROUGH_ID}`;
}

// The slice of the `vscode` namespace the walkthrough needs; extension.ts
// passes the real module, tests a fake.
export interface VscodeWalkthroughApi {
  commands: { executeCommand(command: string, ...args: unknown[]): PromiseLike<unknown> };
}

// Thin adapter: opens the Get Started walkthrough through VS Code's own
// command (also what the Command Palette's "Welcome: Open Walkthrough" runs).
export function createVscodeWalkthrough(vscode: VscodeWalkthroughApi, extensionId: string): WalkthroughLauncher {
  return {
    async open() {
      await vscode.commands.executeCommand("workbench.action.openWalkthrough", walkthroughId(extensionId));
    },
  };
}
