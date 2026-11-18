// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { basename, dirname, join, resolve } from "node:path";
import { errorCode, type ConfigFs } from "./config-fs.js";

const PERMISSION_BITS = 0o777;
// Linux's own limit on links followed while resolving one path.
const MAX_LINK_HOPS = 40;

/**
 * Replaces `target`'s content through a temporary file in the same folder
 * and a rename, so a reader (or a crash) sees the old file or the new one,
 * never a half-written one. The temporary file is removed when any step
 * fails, which leaves the original untouched.
 */
export async function replaceFileAtomically(
  fs: ConfigFs,
  target: string,
  content: string,
  randomSuffix: () => string,
): Promise<void> {
  const mode = (await fs.stat(target)).mode & PERMISSION_BITS;
  const temp = join(
    dirname(target),
    `.${basename(target)}.${randomSuffix()}.tmp`,
  );
  try {
    await fs.writeFile(temp, content, { mode, flag: "wx" });
    // The mode given to writeFile passes through the umask; the original's
    // bits must survive exactly.
    await fs.chmod(temp, mode);
    await fs.rename(temp, target);
  } catch (error) {
    await removeOwnFile(fs, temp, error);
    throw error;
  }
}

/** Creates `target` and its folders; fails rather than overwrite a file that appeared meanwhile. */
export async function createFileExclusively(
  fs: ConfigFs,
  target: string,
  content: string,
  mode: number,
): Promise<void> {
  await fs.mkdir(dirname(target), { recursive: true });
  try {
    await fs.writeFile(target, content, { mode, flag: "wx" });
  } catch (error) {
    await removeOwnFile(fs, target, error);
    throw error;
  }
}

// EEXIST means the "wx" open found someone else's file: never delete that.
async function removeOwnFile(
  fs: ConfigFs,
  path: string,
  cause: unknown,
): Promise<void> {
  if (errorCode(cause) === "EEXIST") return;
  await fs.unlink(path).catch(() => undefined);
}

/**
 * The file a write to `path` should land in. A symlinked config (dotfile
 * managers do this) is written at its real target so the link survives; a
 * link whose target does not exist yet resolves to that target, so the file
 * is created where the link points instead of replacing the link.
 */
export async function resolveWriteTarget(
  fs: ConfigFs,
  path: string,
): Promise<string> {
  try {
    return await fs.realpath(path);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  let current = path;
  for (let hop = 0; hop < MAX_LINK_HOPS; hop++) {
    let link: string;
    try {
      link = await fs.readlink(current);
    } catch (error) {
      // ENOENT: nothing there yet. EINVAL: a real file or folder, not a link.
      if (errorCode(error) === "ENOENT" || errorCode(error) === "EINVAL")
        return current;
      throw error;
    }
    current = resolve(dirname(current), link);
  }
  throw new Error(`${path}: too many levels of symbolic links`);
}
