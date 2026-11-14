// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { play, totalBeatMs } from "../../../web/e2e/demo/support/demo-driver.js";
import { modelTurnsIn } from "../support/call-log.js";
import { expect, test } from "../support/host-fixture.js";
import { F3, f3Args, FULLSCREEN, type DemoContext } from "./scenes.js";
import { applyDemoLayout, installPointer } from "./support/demo-setup.js";
import { recordScene } from "./support/record.js";

const PROVIDER = "claude-code";

// F3 (docs/plans/docs-refresh-and-demo-recordings.md §4.2): the replay views, then the statement.
test("F3: compare models, replay; statement", async ({ page, host }) => {
  // The fixture's 2026-10-05 session, found by its start (as u12-replay.spec.ts does).
  const { sessions } = (await host.lookup("list_sessions", { provider: PROVIDER })) as { sessions: { id: string; startedAt?: string }[] };
  const found = sessions.find((session) => session.startedAt === "2026-10-05T09:00:00.000Z");
  expect(found, "the fixture home's 2026-10-05 session").toBeDefined();
  const session = { sessionId: found!.id, provider: PROVIDER };

  await applyDemoLayout(page);
  const view = await host.show("compare_models_for_session", f3Args(session), FULLSCREEN);
  await expect(view.title()).toContainText("Replay on other models");
  await expect(view.replay.measuredRow()).toBeVisible();
  const context = { host, view, session } as DemoContext;
  const scene = F3(context);
  expect(totalBeatMs(scene)).toBeLessThan(20_000);
  const pointer = await installPointer(page);

  await recordScene(page, scene, async () => {
    await play(page, scene, pointer);

    // End state: the project's draft statement; the replay was a plain tool call.
    await expect(context.view.title()).toHaveText("Customer portal · October 2026");
    await expect(context.view.statement.status()).toHaveText("Draft");
    expect(host.calls.some((call) => call.method === "tools/call" && call.name === "replay_session")).toBe(true);
    expect(modelTurnsIn(host.calls)).toEqual([]);
  });
});
