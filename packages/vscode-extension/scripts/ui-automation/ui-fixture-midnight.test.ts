// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createExtensionApiService } from "@agent-cost-analyzer/server/src/composition/create-extension-api-service";
import { InMemoryAppSettingsStore } from "@agent-cost-analyzer/server/src/test-support/in-memory-app-settings-store";
import { copilotLogPathsFromUserDataDir } from "../../src/platform/copilot-log-paths.js";
import { createUiFixture } from "./ui-fixture.mts";

// CI runs at any hour. Every session the fixture dates before `now` is a "today" session (the monthly
// allowance spec expects today's cost to equal the month's), so none may land on yesterday or last month.
describe("the UI fixture's today sessions around local midnight", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  // sessionCount 1: only the sessions dated just before `now` (the base's hourly fillers are older on purpose).
  async function startsAt(now: Date): Promise<{ id: string; started: number }[]> {
    const rootDir = mkdtempSync(path.join(tmpdir(), "aica-ui-mid-"));
    roots.push(rootDir);
    const fixture = createUiFixture(rootDir, { sessionCount: 1, now });
    const here = path.dirname(fileURLToPath(import.meta.url));
    const api = createExtensionApiService({
      ...copilotLogPathsFromUserDataDir(fixture.userDataDir),
      copilotHome: fixture.copilotHome,
      appSettings: new InMemoryAppSettingsStore(),
      learnScriptsDir: path.resolve(here, "../../../server/fixtures/learn-scripts"),
      vendorProfilesDir: path.resolve(here, "../../../server/fixtures/vendor-profiles"),
      appVersion: "0.0.0-test",
    });
    const sessions = await api.listSessions();
    return sessions.map((session) => ({ id: session.id, started: Date.parse(session.startedAt ?? "") })).sort((a, b) => a.started - b.started || a.id.localeCompare(b.id));
  }

  const day = (date: Date) => date.toLocaleDateString("en-CA");

  it.each([
    ["00:05 on a mid-month day", new Date(2026, 5, 17, 0, 5, 0)],
    ["00:05 on the 1st of a month", new Date(2026, 6, 1, 0, 5, 0)],
    ["00:00:30 on the 1st of a month", new Date(2026, 6, 1, 0, 0, 30)],
  ])("keeps every session on the day of `now`, before it, in noon's order (%s)", async (_label, now) => {
    const noon = new Date(now);
    noon.setHours(12, 0, 0, 0);
    const reference = await startsAt(noon);
    const sessions = await startsAt(now);
    expect(sessions.length).toBeGreaterThanOrEqual(8);
    for (const session of sessions) {
      expect(day(new Date(session.started))).toBe(day(now));
      expect(session.started).toBeLessThanOrEqual(now.getTime());
    }
    expect(sessions.map((s) => s.id)).toEqual(reference.map((s) => s.id));
  });
});
