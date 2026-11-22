// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The npm-package smoke's write-scope check (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/npm-package.md §4.4, §4.8 step
// 7): the app writes only its own settings folder, so the fixture home is
// recorded before and after and every other change fails the smoke.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import path from "node:path";
import { resolveAppSettingsDir } from "../../server/src/platform/app-settings-dir/resolve-app-settings-dir.js";

const pathFor = (platform: NodeJS.Platform) => (platform === "win32" ? path.win32 : path.posix);

/** The per-user folders the smoke points into the fixture home, for the app and npm alike. */
export function fixtureHomeEnv(home: string, platform: NodeJS.Platform): Record<string, string> {
  const join = pathFor(platform).join;
  return {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
  };
}

/** The app's settings folder under fixtureHomeEnv, relative to the home, with / separators. */
export function appSettingsDirIn(home: string, platform: NodeJS.Platform): string {
  const absolute = resolveAppSettingsDir({ platform, homeDir: home, env: fixtureHomeEnv(home, platform) });
  return pathFor(platform).relative(home, absolute).split(pathFor(platform).sep).join("/");
}

/** Relative path ("/" separators) to "dir", "file:<sha256>" or "link:<target>". */
export type TreeSnapshot = ReadonlyMap<string, string>;

/** Every folder, file and link under `root`, in path order. */
export function snapshotTree(root: string): Map<string, string> {
  const entries: [string, string][] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) entries.push([relative, `link:${readlinkSync(absolute)}`]);
      else if (entry.isDirectory()) {
        entries.push([relative, "dir"]);
        walk(absolute, relative);
      } else entries.push([relative, `file:${createHash("sha256").update(readFileSync(absolute)).digest("hex")}`]);
    }
  };
  walk(root, "");
  return new Map(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export interface TreeChange {
  path: string;
  kind: "added" | "removed" | "modified";
  directory: boolean;
}

export function treeChanges(before: TreeSnapshot, after: TreeSnapshot): TreeChange[] {
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return paths.flatMap((entry): TreeChange[] => {
    const was = before.get(entry);
    const is = after.get(entry);
    if (was === is) return [];
    const kind = was === undefined ? "added" : is === undefined ? "removed" : "modified";
    return [{ path: entry, kind, directory: (is ?? was) === "dir" }];
  });
}

/**
 * The changes the app may not make: anything outside `allowedDir`, except
 * creating the folders that lead to it (a first run creates the settings
 * folder).
 */
export function changesOutside(changes: readonly TreeChange[], allowedDir: string): TreeChange[] {
  const inside = (entry: string) => entry === allowedDir || entry.startsWith(`${allowedDir}/`);
  const leadsTo = (entry: string) => allowedDir.startsWith(`${entry}/`);
  return changes.filter((change) => !inside(change.path) && !(change.kind === "added" && change.directory && leadsTo(change.path)));
}
