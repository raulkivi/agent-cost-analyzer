// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fallbackSessionTitle } from "../../services/session-enricher/session-enricher.js";
import {
  readAgentHostFixtureRows,
  sessionRowsWithUsageOnly,
  writeAgentHostCatalog,
  writeAgentSessionDb,
  type AgentHostTableRows,
} from "../../test-support/agent-host-user-data-dir.js";
import { AgentHostSessionSource } from "./agent-host-session-source.js";

const SESSION_ID = "3f2a9c10-1111-4a1b-8c01-aaaaaaaaaaa1";
const SDK_ID = "5d1a0001-aaaa-4bbb-8ccc-000000000001";
const FIRST_PROMPT = "Please refactor the billing module so that retries are idempotent\nand add tests for every failure path";
const PROMPT_OPENING = "Please refactor the billing module so that retries are idempotent";

describe("Agent Host titles that are the first prompt's opening", () => {
  let userDataDir: string;
  let copilotHome: string;

  beforeEach(() => {
    userDataDir = mkdtempSync(path.join(tmpdir(), "agent-host-titles-"));
    copilotHome = mkdtempSync(path.join(tmpdir(), "copilot-home-"));
  });
  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(copilotHome, { recursive: true, force: true });
  });

  function writeEventLog(prompt: string | null): void {
    const dir = path.join(copilotHome, "session-state", SDK_ID);
    mkdirSync(dir, { recursive: true });
    const lines = [
      { id: "e1", type: "session.start", data: {} },
      ...(prompt === null ? [] : [{ id: "e2", type: "user.message", data: { content: prompt } }]),
    ];
    writeFileSync(path.join(dir, "events.jsonl"), lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  }

  // The catalog fixture's first session, retitled, with a chat row that
  // names the event log. `storeTitle` becomes session.db's customTitle.
  function setUp(catalogTitle: string | null, storeTitle: string | null = null): void {
    const rows = readAgentHostFixtureRows("catalog-rows.json");
    const [first] = rows.sessions_v2;
    const payload = first!.payload as { data: Record<string, unknown> };
    if (catalogTitle === null) {
      delete payload.data.summary;
    } else {
      payload.data.summary = catalogTitle;
    }
    const catalogRows: AgentHostTableRows = {
      ...rows,
      chats_v2: [
        {
          chat_uri: "ahp-chat://default/chat1",
          owner_session_uri: `copilotcli:/${SESSION_ID}`,
          chat_order: 0,
          provider_data: JSON.stringify({ sdkSessionId: SDK_ID }),
          metadata: "{}",
          metadata_hash: "h",
        },
      ],
    };
    writeAgentHostCatalog(userDataDir, catalogRows);
    const session = sessionRowsWithUsageOnly();
    writeAgentSessionDb(userDataDir, SESSION_ID, {
      ...session,
      session_metadata: [
        ...(session.session_metadata ?? []).filter((row) => row.key !== "customTitle"),
        ...(storeTitle === null ? [] : [{ key: "customTitle", value: storeTitle }]),
      ],
    });
  }

  const source = (home: string | null = copilotHome) => new AgentHostSessionSource({ userDataDir, copilotHome: home });
  const listed = async () => (await source().listSessions()).find((session) => session.id === SESSION_ID)!;
  const untitled = fallbackSessionTitle(SESSION_ID);

  it("lists a catalog title that is the opening of the first prompt as untitled", async () => {
    writeEventLog(FIRST_PROMPT);
    setUp(PROMPT_OPENING);

    expect((await listed()).title).toBe(untitled);
  });

  it("lists a catalog title truncated with an ellipsis as untitled", async () => {
    writeEventLog(FIRST_PROMPT);
    setUp("Please refactor the billing module so that...");

    expect((await listed()).title).toBe(untitled);
  });

  it("skips a store customTitle that is the opening of the first prompt and uses the catalog title", async () => {
    writeEventLog(FIRST_PROMPT);
    setUp("Billing retries", PROMPT_OPENING);

    expect((await listed()).title).toBe("Billing retries");
  });

  it("falls back to the catalog title only when that one is not an echo either", async () => {
    writeEventLog(FIRST_PROMPT);
    setUp(PROMPT_OPENING, PROMPT_OPENING);

    expect((await listed()).title).toBe(untitled);
  });

  it("keeps a title the user set", async () => {
    writeEventLog(FIRST_PROMPT);
    setUp("Billing retries", "My billing retries session");

    expect((await listed()).title).toBe("My billing retries session");
  });

  it("keeps the title when the first prompt can't be read (no log, no home, no user message)", async () => {
    setUp(PROMPT_OPENING);
    expect((await listed()).title).toBe(PROMPT_OPENING);

    writeEventLog(null);
    expect((await listed()).title).toBe(PROMPT_OPENING);

    writeEventLog(FIRST_PROMPT);
    expect((await source(null).listSessions()).find((session) => session.id === SESSION_ID)!.title).toBe(PROMPT_OPENING);
  });

  it("reads a session by id with the same rule", async () => {
    writeEventLog(FIRST_PROMPT);
    setUp(PROMPT_OPENING);

    expect((await source().readSession(SESSION_ID))?.title).toBe(untitled);
  });

  it("keeps a user-set title when reading a session by id", async () => {
    writeEventLog(FIRST_PROMPT);
    setUp("Billing retries");

    expect((await source().readSession(SESSION_ID))?.title).toBe("Billing retries");
  });
});
