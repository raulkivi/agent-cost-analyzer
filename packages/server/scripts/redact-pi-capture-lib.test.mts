// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  compareSummaries,
  findLeaks,
  maskIdentifiers,
  redactCapture,
  redactSession,
  redactSidecarRecord,
  redactText,
  summariseCapture,
  type RedactionContext,
} from "./redact-pi-capture-lib.mjs";

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/pi-agent");
const syntheticSession = readFileSync(path.join(fixtureDir, "schema-v3-session.jsonl"), "utf8");

const ctx: RedactionContext = {
  usernames: ["alice"],
  hostnames: ["alice-laptop"],
  cwds: ["/home/alice/secret-project"],
};

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
  }
});
const tmp = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "redact-pi-"));
  tmpDirs.push(dir);
  return dir;
};

describe("redactText", () => {
  it("keeps the exact length and whitespace layout", () => {
    const text = "Fix the login bug\n  in auth.ts\t now";
    const out = redactText(text);
    expect(out).toHaveLength(text.length);
    expect(out.replace(/[^ \t\r\n]/g, "x")).toBe(text.replace(/[^ \t\r\n]/g, "x"));
  });

  it("is deterministic and maps the same word the same way", () => {
    expect(redactText("alpha beta alpha")).toBe(redactText("alpha beta alpha"));
    const [a, , c] = redactText("alpha beta alpha").split(" ");
    expect(a).toBe(c);
  });

  it("is compositional over whitespace-separated words", () => {
    const whole = redactText("one two three four");
    expect(whole).toContain(redactText("two three"));
  });

  it("leaves no input word of four or more letters in the output", () => {
    const words = ["password", "customer", "invoice", "kubernetes", "refactor", "database"];
    const out = redactText(words.join(" "));
    for (const word of words) {
      expect(out).not.toContain(word);
    }
  });

  it("replaces hostile characters (bidi, zero-width, line separators) with plain letters of the same length", () => {
    const hostile = "a\u202Eb\u200Bc\u2028d\u2029e\u00A0f \uD83D\uDE00z";
    const out = redactText(hostile);
    expect(out).toHaveLength(hostile.length);
    expect(out).toMatch(/^[a-z \t\r\n]+$/);
  });
});

describe("redactSession", () => {
  const redacted = redactSession(syntheticSession);
  const originalLines = syntheticSession.trim().split("\n").map((l) => JSON.parse(l));
  const redactedLines = redacted.text.trim().split("\n").map((l) => JSON.parse(l));

  it("keeps entry count, types, ids, parent links, timestamps byte-for-byte", () => {
    expect(redactedLines).toHaveLength(originalLines.length);
    redactedLines.forEach((line, i) => {
      for (const key of ["type", "id", "parentId", "timestamp", "version"]) {
        expect(line[key]).toEqual(originalLines[i][key]);
      }
    });
  });

  it("keeps usage figures, model ids and tool names unchanged", () => {
    redactedLines.forEach((line, i) => {
      const original = originalLines[i];
      expect(line.usage).toEqual(original.usage);
      expect(line.message?.usage).toEqual(original.message?.usage);
      expect(line.message?.model).toBe(original.message?.model);
      expect(line.message?.toolName).toBe(original.message?.toolName);
    });
    const call = redactedLines[3].message.content[1];
    expect(call.name).toBe("bash");
    expect(call.id).toBe("call-1");
    expect(Object.keys(call.arguments)).toEqual(["command"]);
  });

  it("rewrites the header cwd and replaces every free-text value with a same-length placeholder", () => {
    expect(redactedLines[0].cwd).toBe("/home/user/project");
    const user = redactedLines[2].message.content;
    expect(user).toBe(redactText(originalLines[2].message.content));
    expect(user).toHaveLength(originalLines[2].message.content.length);
    expect(redactedLines[3].message.content[1].arguments.command).toHaveLength("npm test".length);
    expect(redactedLines[3].message.content[1].arguments.command).not.toContain("npm");
  });

  it("keeps section names and length, and tool-declaration structure", () => {
    const system = redactedLines[1].message;
    const original = originalLines[1].message;
    expect(Object.keys(system.sections)).toEqual(Object.keys(original.sections));
    expect(system.sections.tools).toHaveLength(original.sections.tools.length);
    expect(system.toolsAdded.map((t: { name: string }) => t.name)).toEqual(["read", "bash", "write"]);
    expect(system.toolsAdded[0].parameters.properties.path.type).toBe("string");
  });

  it("keeps no free-text word from the original", () => {
    const freeWords = ["Summarize", "suite", "expert", "coding", "working", "directory"];
    for (const word of freeWords) {
      expect(redacted.text).not.toContain(word);
    }
  });

  it("masks home paths, usernames, hostnames, emails and secrets in kept fields and keys", () => {
    const raw = [
      JSON.stringify({ type: "session", version: 3, id: "x", timestamp: "t", cwd: "/home/alice/secret-project" }),
      JSON.stringify({
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "t",
        customType: "alice-laptop /home/alice/notes bob@corp.example sk-abcdefghijklmnopqrstuvwx",
        message: { role: "user", content: "hi from alice at alice-laptop", timestamp: 1 },
      }),
    ].join("\n");
    const out = redactSession(raw, ctx);
    expect(out.text).not.toMatch(/alice|corp\.example|sk-abc/);
    expect(out.text).toContain("/home/user/notes");
    expect(findLeaks(out.text, ctx)).toEqual([]);
  });

  it("findLeaks flags a surviving username, home path and email", () => {
    expect(findLeaks('{"a":"/home/alice/x bob@corp.example"}', ctx).sort()).toEqual(["email", "home-path", "username"]);
  });

  it("survives hostile text in every free-text slot and still parses", () => {
    const hostile = "x\u202Ey\u200Bz\u2028w\u2029 hidden-secret-token";
    const raw = [
      JSON.stringify({ type: "session", version: 3, id: "x", timestamp: "t", cwd: "/home/alice/p" }),
      JSON.stringify({
        type: "message",
        id: "m1",
        parentId: null,
        timestamp: "t",
        message: { role: "user", content: hostile, timestamp: 1 },
      }),
    ].join("\n");
    const out = redactSession(raw);
    const parsed = JSON.parse(out.text.split("\n")[1]);
    expect(parsed.message.content).toHaveLength(hostile.length);
    expect(out.text).not.toContain("hidden-secret-token");
    expect(out.text).not.toMatch(/[\u202E\u200B\u2028\u2029]/);
  });

  it("replaces a malformed line with same-length placeholder text and counts it", () => {
    const out = redactSession(`${syntheticSession.split("\n")[0]}\n{"broken": secret words here\n`);
    expect(out.report.malformedLines).toBe(1);
    expect(out.text).not.toContain("secret");
  });

  it("reports the keys whose values it replaced, never the values", () => {
    expect(Object.keys(redacted.report.redactedKeys)).toEqual(expect.arrayContaining(["content", "thinking", "summary"]));
  });
});

describe("redactSidecarRecord", () => {
  const sections = { tools: "<tools>\n- read: Read a file\n</tools>", cwd: "Current working directory: /home/alice/secret-project" };
  const prompt = `You are an expert.\n\n${sections.tools}\n\n${sections.cwd}\n\nExtension note: mounted /work for alice.`;
  const record = {
    sessionId: "33333333-3333-3333-3333-333333333333",
    sessionFile: "/home/alice/.pi/agent/sessions/--home-alice-secret-project--/2026_abc.jsonl",
    capturedAt: "2026-08-05T09:00:00.000Z",
    cwd: "/home/alice/secret-project",
    provider: "anthropic",
    modelId: "claude-sonnet-4-5",
    systemPromptChars: prompt.length,
    systemPrompt: prompt,
    selectedTools: ["read", "bash"],
    skillNames: ["review"],
    contextFilePaths: ["/home/alice/secret-project/AGENTS.md"],
  };

  it("keeps length, counts and names; rewrites cwd and file paths", () => {
    const out = redactSidecarRecord(record, [sections.tools, sections.cwd, "You are an expert."], ctx, "pi-linear");
    expect(out.systemPrompt).toHaveLength(prompt.length);
    expect(out.systemPromptChars).toBe(prompt.length);
    expect(out.cwd).toBe("/home/user/project");
    expect(out.sessionFile).toBe("/home/user/.pi/agent/sessions/--home-user-project--/pi-linear.jsonl");
    expect(out.selectedTools).toEqual(["read", "bash"]);
    expect(out.skillNames).toEqual(["review"]);
    expect(out.contextFilePaths).toEqual(["/home/user/project/AGENTS.md"]);
    expect(out.sessionId).toBe(record.sessionId);
    expect(JSON.stringify(out)).not.toMatch(/alice|expert|mounted/);
  });

  it("redacts an in-file section identically in the sidecar text, even when glued to other text", () => {
    const glued = { ...record, systemPrompt: `${sections.tools}Added${sections.cwd}`, systemPromptChars: 0 };
    const out = redactSidecarRecord(glued, [sections.tools, sections.cwd], ctx, "s");
    expect(out.systemPrompt).toContain(redactText(sections.tools));
    expect(out.systemPrompt).toContain(redactText(sections.cwd));
  });
});

describe("verify: the pi provider reads the redacted capture like the original", () => {
  it("keeps turn count, token figures, branch structure and prompt component sizes", async () => {
    const session = redactSession(syntheticSession);
    const prompt =
      "You are an expert coding assistant.\n\n<tools>\n- read: Read a file\n- bash: Run a shell command\n- write: Write a file\n</tools>\n\nCurrent working directory: /home/user/schema-project\n\nAdded by an extension: mount /work.";
    const record = {
      sessionId: "33333333-3333-3333-3333-333333333333",
      sessionFile: "/x/schema.jsonl",
      capturedAt: "2026-08-05T09:00:00.000Z",
      cwd: "/home/user/schema-project",
      systemPromptChars: prompt.length,
      systemPrompt: prompt,
    };
    const redactedRecord = redactSidecarRecord(record, session.pieces, session.context, "schema");

    const before = await summariseCapture(tmp(), { sessionText: syntheticSession, records: [record] });
    const after = await summariseCapture(tmp(), { sessionText: session.text, records: [redactedRecord] });

    expect(before.sessions.length).toBeGreaterThan(0);
    expect(before.sessions[0].turnCount).toBeGreaterThan(0);
    expect(before.sessions[0].promptComponents.length).toBeGreaterThan(1);
    expect(compareSummaries(before, after)).toEqual([]);
  });

  it("reports a difference when a token figure changes", async () => {
    const tampered = syntheticSession.replace('"input":1000', '"input":1001');
    const before = await summariseCapture(tmp(), { sessionText: syntheticSession, records: [] });
    const after = await summariseCapture(tmp(), { sessionText: tampered, records: [] });
    expect(compareSummaries(before, after).length).toBeGreaterThan(0);
  });
});

describe("extra path masks (generated captures live under a temp dir)", () => {
  const tempCtx: RedactionContext = {
    usernames: [],
    hostnames: [],
    cwds: ["/tmp/pi-fixtures-x1/home/project"],
    paths: [
      { from: "/tmp/pi-fixtures-x1/home", to: "/home/user" },
      { from: "tmp-pi-fixtures-x1-home", to: "home-user" },
    ],
  };

  it("maps each temp path to its placeholder, longest first, after the cwd", () => {
    expect(maskIdentifiers("/tmp/pi-fixtures-x1/home/project/a.ts", tempCtx)).toBe("/home/user/project/a.ts");
    expect(maskIdentifiers("/tmp/pi-fixtures-x1/home/.pi/agent/x", tempCtx)).toBe("/home/user/.pi/agent/x");
    expect(maskIdentifiers("--tmp-pi-fixtures-x1-home-project--", tempCtx)).toBe("--home-user-project--");
  });

  it("findLeaks flags a temp path that survived", () => {
    expect(findLeaks("see /tmp/pi-fixtures-x1/home/.pi", tempCtx)).toContain("temp-path");
    expect(findLeaks("see /home/user/.pi", tempCtx)).toEqual([]);
  });
});

describe("redactCapture", () => {
  it("redacts a session and only its own sidecar records, then runs the leak scan and the provider check", async () => {
    const header = JSON.parse(syntheticSession.split("\n")[0]) as { id: string };
    const sessionPath = "/x/sessions/schema.jsonl";
    const records = [
      { sessionId: header.id, sessionFile: sessionPath, capturedAt: "2026-08-05T09:00:00.000Z", cwd: "/home/alice/secret-project", systemPromptChars: 3, systemPrompt: "abc" },
      { sessionId: "someone-else", sessionFile: "/x/sessions/other.jsonl", capturedAt: "2026-08-05T09:00:00.000Z", cwd: "/w", systemPromptChars: 3, systemPrompt: "xyz" },
    ];
    const sidecarText = records.map((r) => JSON.stringify(r)).join("\n") + "\n";

    const out = await redactCapture({ sessionText: syntheticSession, sessionPath, sidecarText, stem: "schema", context: ctx });

    expect(out.recordCount).toBe(1);
    expect(out.leaks).toEqual([]);
    expect(out.diffs).toEqual([]);
    expect(out.sidecarText.trim().split("\n")).toHaveLength(1);
    expect(out.sessionText).not.toMatch(/alice/);
    expect(out.branchTurns.length).toBeGreaterThan(0);
  });
});
