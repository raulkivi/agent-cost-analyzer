// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { COPILOT_READY_LIMIT_MS, COPILOT_READY_POLL_MS, copilotReadiness, NOT_OBSERVED, type CopilotSignals } from "./copilot-readiness.mts";

const READY: CopilotSignals = { githubAccount: true, copilotChatActive: true, copilotModels: 2 };

describe("copilotReadiness (wait for Copilot to start, don't skip on a slow start-up)", () => {
  it("polls every 2 s for up to 120 s", () => {
    expect(COPILOT_READY_POLL_MS).toBe(2_000);
    expect(COPILOT_READY_LIMIT_MS).toBe(120_000);
  });

  it("is ready once an account is signed in, Copilot Chat is active and offers a model", () => {
    expect(copilotReadiness(READY, 0)).toEqual({ status: "ready" });
    expect(copilotReadiness(READY, 119_000)).toEqual({ status: "ready" });
  });

  it("keeps waiting while any part is missing and the limit hasn't passed", () => {
    expect(copilotReadiness({ ...READY, githubAccount: false }, 0)).toEqual({ status: "waiting" });
    expect(copilotReadiness({ ...READY, copilotChatActive: false }, 60_000)).toEqual({ status: "waiting" });
    expect(copilotReadiness({ ...READY, copilotModels: 0 }, 119_999)).toEqual({ status: "waiting" });
    expect(copilotReadiness(NOT_OBSERVED, 0)).toEqual({ status: "waiting" });
  });

  it("gives up at the limit, naming each part that wasn't ready and how long it waited", () => {
    const result = copilotReadiness({ githubAccount: true, copilotChatActive: false, copilotModels: 0 }, 120_000);

    expect(result.status).toBe("gave-up");
    const reason = result.status === "gave-up" ? result.reason : "";
    expect(reason).toContain("after 120 s");
    expect(reason).toContain("Copilot Chat (GitHub.copilot-chat) isn't active");
    expect(reason).toContain("no Copilot language model is available");
    expect(reason).not.toContain("GitHub account");
  });

  it("says when no GitHub account is signed in, pointing at the sign-in script", () => {
    const result = copilotReadiness({ ...READY, githubAccount: false }, 130_000);
    expect(result.status === "gave-up" && result.reason).toMatch(/no GitHub account is signed in[\s\S]*test:ui:vscode:copilot:signin/);
  });

  it("is ready rather than given up when everything turns up exactly at the limit", () => {
    expect(copilotReadiness(READY, 120_000)).toEqual({ status: "ready" });
  });

  it("takes another limit", () => {
    expect(copilotReadiness(NOT_OBSERVED, 5_000, 5_000).status).toBe("gave-up");
  });
});
