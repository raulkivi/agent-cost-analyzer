// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { MIN_SCORE, clickPoint, type Match, type Point } from "./click-point.mts";
import type { DesktopAction } from "./desktop-scenes.mts";
import { waitForGone, waitForMatch, type Clock } from "./wait-for-match.mts";

export interface ActionDeps {
  input: {
    key(chord: string): Promise<void>;
    type(text: string, delayMs: number): Promise<void>;
    click(point: Point): Promise<void>;
  };
  // Best match of a template in a fresh frame, whatever its score.
  find(template: string): Promise<Match | undefined>;
  startRecording(): Promise<void>;
  clock: Clock;
  pacing: { typeDelayMs: number; timeoutMs: number; intervalMs: number };
}

export interface ActionRunner {
  perform(action: DesktopAction): Promise<void>;
  // True once a permission prompt had to be clicked away: D16 says a final take shows none.
  retakeNeeded(): boolean;
}

const AFTER_PROMPT_CLICK_MS = 500;

export function createActionRunner(deps: ActionDeps): ActionRunner {
  let retake = false;
  const wait = { timeoutMs: deps.pacing.timeoutMs, intervalMs: deps.pacing.intervalMs };

  const seen = async (template: string): Promise<Match | undefined> => {
    const match = await deps.find(template);
    return match && match.score >= MIN_SCORE ? match : undefined;
  };

  // Every wait also clears a permission prompt, else a hidden prompt would stall the answer.
  const probe = (template: string) => async () => {
    const prompt = await seen("always-allow");
    if (prompt) {
      retake = true;
      await deps.input.click(clickPoint(prompt)!);
      await deps.clock.sleep(AFTER_PROMPT_CLICK_MS);
    }
    return seen(template);
  };

  return {
    retakeNeeded: () => retake,
    async perform(action) {
      switch (action.kind) {
        case "newChat":
          return deps.input.key("ctrl+n");
        case "prompt":
          await deps.input.type(action.text, deps.pacing.typeDelayMs);
          return deps.input.key("Return");
        case "startRecording":
          return deps.startRecording();
        case "waitFor":
          await waitForMatch(action.template, probe(action.template), wait, deps.clock);
          return;
        case "waitAnswerDone":
          return waitForGone("stop", probe("stop"), wait, deps.clock);
        case "click": {
          const match = await waitForMatch(action.template, probe(action.template), wait, deps.clock);
          return deps.input.click(clickPoint(match)!);
        }
        case "beat":
          return;
      }
    },
  };
}
