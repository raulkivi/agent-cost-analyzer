// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { ProjectStore, ProjectStoreRead } from "../../services/cost-attribution/project-store.js";

// Phase 15 step 15.3: the standalone app's projects file, `projects.json`
// in the same settings folder as its settings.json (resolveAppSettingsDir).
// The file name is fixed, so no request can choose where to write. A write
// goes to a temporary file in the same folder and is renamed over the old
// one, so a crash never leaves a half-written file.
export const PROJECTS_FILE_NAME = "projects.json";
// A hand-sized file; far above any real one, far below a memory problem.
export const MAX_PROJECTS_FILE_BYTES = 1024 * 1024;

export class FileProjectStore implements ProjectStore {
  readonly location: string;

  constructor(private readonly settingsDir: string) {
    this.location = path.join(settingsDir, PROJECTS_FILE_NAME);
  }

  read(): ProjectStoreRead {
    let size: number;
    try {
      const stats = statSync(this.location);
      if (!stats.isFile()) {
        return { status: "unreadable", reason: `${this.location} is not a file.` };
      }
      size = stats.size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { status: "missing" };
      }
      return { status: "unreadable", reason: `${this.location} can't be read: ${(error as Error).message}` };
    }
    if (size > MAX_PROJECTS_FILE_BYTES) {
      return { status: "unreadable", reason: `${this.location} is larger than ${MAX_PROJECTS_FILE_BYTES} bytes.` };
    }
    try {
      return { status: "read", text: readFileSync(this.location, "utf-8") };
    } catch (error) {
      return { status: "unreadable", reason: `${this.location} can't be read: ${(error as Error).message}` };
    }
  }

  write(text: string): void {
    mkdirSync(this.settingsDir, { recursive: true });
    const temporary = path.join(this.settingsDir, `.${PROJECTS_FILE_NAME}.${randomBytes(6).toString("hex")}.tmp`);
    try {
      writeFileSync(temporary, text, { encoding: "utf-8", mode: 0o600 });
      renameSync(temporary, this.location);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
