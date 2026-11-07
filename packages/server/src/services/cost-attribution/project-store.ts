// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Where the projects file lives (DIP): ProjectCatalog reads and writes text
// through this, so the standalone app can keep it in its settings folder
// and tests (or later the extension's global storage) another place.
export type ProjectStoreRead =
  | { status: "missing" }
  | { status: "read"; text: string }
  | { status: "unreadable"; reason: string };

export interface ProjectStore {
  // Shown to the user so they can back the file up or edit it.
  readonly location: string;
  read(): ProjectStoreRead;
  write(text: string): void;
}
