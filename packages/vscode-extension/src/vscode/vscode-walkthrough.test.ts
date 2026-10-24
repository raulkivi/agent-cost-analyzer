import { describe, expect, it, vi } from "vitest";
import { createVscodeWalkthrough, walkthroughId } from "./vscode-walkthrough.js";

describe("createVscodeWalkthrough (vscode-extension.md §3.5 Onboarding)", () => {
  it("names the walkthrough as <extension id>#<walkthrough id>, as workbench.action.openWalkthrough expects", () => {
    expect(walkthroughId("raulkivi.ai-credits-analyzer")).toBe("raulkivi.ai-credits-analyzer#aiCreditsAnalyzer.getStarted");
  });

  it("opens the Get Started walkthrough through VS Code's own command", async () => {
    const api = { commands: { executeCommand: vi.fn(async () => undefined) } };

    await createVscodeWalkthrough(api, "raulkivi.ai-credits-analyzer").open();

    expect(api.commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.openWalkthrough",
      "raulkivi.ai-credits-analyzer#aiCreditsAnalyzer.getStarted",
    );
  });

  it("passes an editor failure on to the caller", async () => {
    const api = {
      commands: {
        executeCommand: vi.fn(async () => {
          throw new Error("no such walkthrough");
        }),
      },
    };

    await expect(createVscodeWalkthrough(api, "x.y").open()).rejects.toThrow("no such walkthrough");
  });
});
