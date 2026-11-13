// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import type { SceneId } from "./scene-timeline.mts";

// One naming rule for every scene, so the recorder, the GIF converter and the docs agree on paths.
export function sceneOutputs(
  scene: { id: SceneId; slug: string },
  dirs: { masters: string; gifs: string },
): { mp4: string; gif: string; meta: string } {
  const base = `${scene.id.toLowerCase()}-${scene.slug}`;
  return {
    mp4: path.join(dirs.masters, `${base}.mp4`),
    gif: path.join(dirs.gifs, `${base}.gif`),
    meta: path.join(dirs.masters, `${base}.json`),
  };
}
