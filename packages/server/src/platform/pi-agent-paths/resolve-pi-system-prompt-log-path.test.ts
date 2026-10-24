import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePiSystemPromptLogPath } from "./resolve-pi-system-prompt-log-path.js";

describe("resolvePiSystemPromptLogPath", () => {
  it("defaults to ~/.pi/agent/logs/system-prompts.jsonl under the given home dir", () => {
    const homeDir = "/home/user";

    expect(resolvePiSystemPromptLogPath({ homeDir, env: {} })).toBe(
      path.join(homeDir, ".pi", "agent", "logs", "system-prompts.jsonl"),
    );
  });

  it("prefers PI_SYSTEM_PROMPT_LOG_PATH when set, ignoring homeDir", () => {
    const override = "/custom/path/system-prompts.jsonl";

    expect(
      resolvePiSystemPromptLogPath({
        homeDir: "/home/user",
        env: { PI_SYSTEM_PROMPT_LOG_PATH: override },
      }),
    ).toBe(override);
  });

  it("does not require the file to exist", () => {
    const homeDir = "/home/does-not-exist-at-all";

    expect(resolvePiSystemPromptLogPath({ homeDir, env: {} })).toBe(
      path.join(homeDir, ".pi", "agent", "logs", "system-prompts.jsonl"),
    );
  });
});
