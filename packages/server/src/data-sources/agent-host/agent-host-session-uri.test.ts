// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  AGENT_HOST_SESSION_URI_SCHEMES,
  agentHostSessionUrisOf,
  parseAgentHostSessionUri,
} from "./agent-host-session-uri.js";

const ID = "3f2a9c10-1111-4a1b-8c01-aaaaaaaaaaa1";

describe("AGENT_HOST_SESSION_URI_SCHEMES", () => {
  it("takes the storage scheme first, then the Agent Host Protocol runtime scheme", () => {
    expect(AGENT_HOST_SESSION_URI_SCHEMES).toEqual(["copilotcli", "ahp-session"]);
  });
});

describe("parseAgentHostSessionUri", () => {
  it("reads the id after copilotcli:/ with the storage scheme's preference", () => {
    expect(parseAgentHostSessionUri(`copilotcli:/${ID}`)).toEqual({ id: ID, preference: 0 });
  });

  it("reads the id after ahp-session:/ with the runtime scheme's preference", () => {
    expect(parseAgentHostSessionUri(`ahp-session:/${ID}`)).toEqual({ id: ID, preference: 1 });
  });

  it.each([
    ["an empty copilotcli id", "copilotcli:/"],
    ["an empty ahp-session id", "ahp-session:/"],
    ["copilotcli without the slash", `copilotcli:${ID}`],
    ["ahp-session without the slash", `ahp-session:${ID}`],
    ["a longer scheme that starts with copilotcli", `copilotcliX:/${ID}`],
    ["a longer scheme that starts with ahp-session", `ahp-sessions:/${ID}`],
    ["a chat uri", `ahp-chat:/${ID}`],
    ["a Claude session uri", `claude:/${ID}`],
    ["another scheme", `other:/${ID}`],
    ["no scheme", ID],
    ["an upper-case scheme", `COPILOTCLI:/${ID}`],
  ])("returns null for %s", (_label, uri) => {
    expect(parseAgentHostSessionUri(uri)).toBeNull();
  });

  it("removes only the leading scheme, keeping the rest verbatim", () => {
    expect(parseAgentHostSessionUri("ahp-session:/copilotcli:/nested")).toEqual({ id: "copilotcli:/nested", preference: 1 });
    expect(parseAgentHostSessionUri("copilotcli://double")).toEqual({ id: "/double", preference: 0 });
  });
});

describe("agentHostSessionUrisOf", () => {
  it("lists the id's uri under each scheme, in preference order", () => {
    expect(agentHostSessionUrisOf(ID)).toEqual([`copilotcli:/${ID}`, `ahp-session:/${ID}`]);
  });

  it("is empty for the empty id, which names no session", () => {
    expect(agentHostSessionUrisOf("")).toEqual([]);
  });

  it("round-trips through parseAgentHostSessionUri", () => {
    for (const [preference, uri] of agentHostSessionUrisOf(ID).entries()) {
      expect(parseAgentHostSessionUri(uri)).toEqual({ id: ID, preference });
    }
  });
});
