// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { dirname, join, relative, resolve, sep } from "node:path";
import { errorCode, type ConfigFs } from "./config-fs.js";

export interface FoundLink {
  path: string;
  /** Where the link points, made absolute. */
  target: string;
}

type Hop = FoundLink | "plain" | "missing";

async function linkAt(fs: ConfigFs, path: string): Promise<Hop> {
  try {
    const target = await fs.readlink(path);
    return { path, target: resolve(dirname(path), target) };
  } catch (error) {
    // EINVAL: a real file or folder. ENOENT/ENOTDIR: nothing further exists.
    if (errorCode(error) === "EINVAL") return "plain";
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR")
      return "missing";
    throw error;
  }
}

/**
 * The first link on the way from `root` to `path`: each folder inside the
 * project, then the file. A cloned repository can commit any of them as a
 * link pointing anywhere. `root` itself is not checked, since a project
 * folder may well be a link of the user's own.
 */
export async function findProjectLink(
  fs: ConfigFs,
  path: string,
  root: string,
): Promise<FoundLink | undefined> {
  const parts = relative(root, path).split(sep).filter(Boolean);
  for (let i = 1; i <= parts.length; i++) {
    const hop = await linkAt(fs, join(root, ...parts.slice(0, i)));
    if (hop === "missing") return undefined;
    if (hop !== "plain") return hop;
  }
  return undefined;
}
