// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The narrow file access RepositoryResolver needs (DIP): it only asks what
// a path is and reads small text files. No writes, no process, no network.
export type FileKind = "file" | "directory";

export interface ReadOnlyFileSystem {
  // null when the path doesn't exist or can't be inspected.
  kindOf(path: string): FileKind | null;
  // null when the file is missing, unreadable or larger than maxBytes.
  readText(path: string, maxBytes: number): string | null;
}
