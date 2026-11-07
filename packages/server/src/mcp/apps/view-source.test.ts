// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileViewSource, InMemoryViewSource } from "./view-source.js";

describe("ViewSource", () => {
  it("InMemoryViewSource returns its html", async () => {
    expect(await new InMemoryViewSource("<p>x</p>").read()).toBe("<p>x</p>");
  });

  it("FileViewSource reads the file on every call, so a rebuilt bundle is picked up", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "view-source-"));
    try {
      const file = path.join(dir, "views.html");
      writeFileSync(file, "one");
      const source = new FileViewSource(file);
      expect(await source.read()).toBe("one");
      writeFileSync(file, "two");
      expect(await source.read()).toBe("two");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("FileViewSource rejects with a clear message when the bundle is missing", async () => {
    await expect(new FileViewSource("/nonexistent/views.html").read()).rejects.toThrow(/views\.html/);
  });
});
