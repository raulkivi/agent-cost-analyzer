// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// A demo scene as data: ordered steps, each followed by a pause so a viewer can read the frame.

export type SceneId = `${"E" | "W" | "M" | "F"}${number}`;
export type DemoStep<A> = { label: string; action: A; beatMs: number };
export type Scene<A> = { id: SceneId; slug: string; title: string; steps: DemoStep<A>[] };

export function totalBeatMs(scene: Scene<unknown>): number {
  return scene.steps.reduce((sum, step) => sum + step.beatMs, 0);
}

export async function playScene<A>(
  scene: Scene<A>,
  run: (action: A) => Promise<void>,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  for (const step of scene.steps) {
    await run(step.action);
    await sleep(step.beatMs);
  }
}

const ID = /^[EWMF][0-9]+$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Fails early so a typo surfaces before a recording starts, not after.
export function assertScene(scene: Scene<unknown>): void {
  if (!ID.test(scene.id)) throw new Error(`Scene id "${scene.id}" must match ${ID.source}`);
  if (!SLUG.test(scene.slug)) throw new Error(`Scene ${scene.id}: slug "${scene.slug}" must be lowercase kebab-case`);
  if (scene.steps.length === 0) throw new Error(`Scene ${scene.id} has no steps`);
  for (const step of scene.steps) {
    if (!Number.isFinite(step.beatMs) || step.beatMs < 0) {
      throw new Error(`Scene ${scene.id}, step "${step.label}": beat must be a finite number >= 0`);
    }
  }
}
