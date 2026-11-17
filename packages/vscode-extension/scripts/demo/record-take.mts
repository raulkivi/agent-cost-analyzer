// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Recorder } from "./recorder.mts";

// One take: record while the scene plays, stop right after its last beat, then run the
// end-state checks and the privacy probe. The checks used to run inside the recording and
// added seconds of still frames to every master. A failing check deletes the master, so a
// failed take never leaves a recording that looks valid.
export interface Take {
  play: () => Promise<void>;
  endChecks?: () => Promise<void>;
}

export async function recordTake(recorder: Pick<Recorder, "ready" | "stop" | "discard">, take: Take): Promise<void> {
  try {
    await recorder.ready();
    await take.play();
    await recorder.stop();
  } catch (error) {
    await recorder.discard();
    throw error;
  }
  try {
    await take.endChecks?.();
  } catch (error) {
    await recorder.discard();
    throw error;
  }
}
