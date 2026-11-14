// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
export interface DesktopArgs {
  scene: string | undefined;
  dryRun: boolean;
}

export function parseDesktopArgs(argv: string[]): DesktopArgs {
  let dryRun = false;
  const scenes: string[] = [];
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("--")) throw new Error(`Unknown flag ${arg}`);
    else scenes.push(arg);
  }
  if (scenes.length > 1) throw new Error("Give one scene id, e.g. M1");
  if (scenes.length === 0 && !dryRun) throw new Error("Give a scene id, e.g. M1, or --dry-run");
  return { scene: scenes[0], dryRun };
}
