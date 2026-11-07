// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ProjectStore, ProjectStoreRead } from "../services/cost-attribution/project-store.js";

export class InMemoryProjectStore implements ProjectStore {
  readonly location = "/settings/projects.json";
  writes = 0;

  constructor(private text: string | null = null, private readonly unreadableReason?: string) {}

  read(): ProjectStoreRead {
    if (this.unreadableReason) {
      return { status: "unreadable", reason: this.unreadableReason };
    }
    return this.text === null ? { status: "missing" } : { status: "read", text: this.text };
  }

  write(text: string): void {
    this.text = text;
    this.writes += 1;
  }

  get current(): string | null {
    return this.text;
  }
}
