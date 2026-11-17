// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The Phase 15 exit check's oracle helpers (cost-by-project-oracle.mts), over
// hand-made inputs: each rule here is the plan's (§4.2, §5, §6.2, §7), so a
// wrong helper fails before it can agree with a wrong product.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  addTurn,
  agentHostCatalogIdOf,
  agentHostCatalogSessions,
  agentHostTurns,
  alignLogTurns,
  claudeCodeTurns,
  copilotClassicTurns,
  emptyCell,
  inChatPanelScope,
  monthOf,
  normaliseRemote,
  piTurns,
  pricedFigure,
  pricedParts,
  projectOf,
  redactKey,
  repositoryKeyOf,
  versionAt,
  type BookVersion,
  type OracleTurn,
} from "./cost-by-project-oracle.mjs";

describe("independence", () => {
  it("imports nothing from the product's sources, only the oracles of other checks (savings, subagent runs)", () => {
    const source = readFileSync(new URL("./cost-by-project-oracle.mts", import.meta.url), "utf-8");
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
    expect(imports.filter((specifier) => specifier.startsWith(".") || specifier.includes("@agent-cost-analyzer"))).toEqual(["./claude-subagent-runs-oracle.mjs", "./savings-oracle.mjs"]);
  });
});

describe("normaliseRemote (plan §4.2 step 2)", () => {
  it("drops scheme, user, token, port and .git, and lower-cases", () => {
    expect(normaliseRemote("git@github.com:Org/App.git")).toBe("github.com/org/app");
    expect(normaliseRemote("https://x:TOKEN@github.com/org/app")).toBe("github.com/org/app");
    expect(normaliseRemote("ssh://git@GitLab.example.com:2222/Group/Sub/Repo.git/")).toBe("gitlab.example.com/group/sub/repo");
    expect(normaliseRemote("https://github.com/org/app.git")).toBe("github.com/org/app");
  });

  it("gives null for a value that names no host and path", () => {
    expect(normaliseRemote("")).toBeNull();
    expect(normaliseRemote("../relative")).toBeNull();
  });
});

describe("repositoryKeyOf (plan §4.2)", () => {
  const root = mkdtempSync(path.join(tmpdir(), "oracle-repo-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };

  const withRemote = path.join(root, "app");
  write(path.join(withRemote, ".git", "config"), '[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://github.com/up/app\n[remote "origin"]\n\turl = git@github.com:Org/App.git\n');
  mkdirSync(path.join(withRemote, "src", "deep"), { recursive: true });

  const noRemote = path.join(root, "local-one");
  write(path.join(noRemote, ".git", "config"), "[core]\n\tbare = false\n");

  const firstRemote = path.join(root, "first");
  write(path.join(firstRemote, ".git", "config"), '[remote "fork"]\n\turl = https://example.org/a/b.git\n');

  // A worktree: .git is a file naming the gitdir, whose commondir leads back.
  const worktree = path.join(root, "wt");
  write(path.join(worktree, ".git"), `gitdir: ${path.join(withRemote, ".git", "worktrees", "wt")}\n`);
  write(path.join(withRemote, ".git", "worktrees", "wt", "commondir"), "../..\n");
  const localWorktree = path.join(root, "local-wt");
  write(path.join(localWorktree, ".git"), "gitdir: ../local-one/.git/worktrees/x\n");
  write(path.join(noRemote, ".git", "worktrees", "x", "commondir"), "../..\n");

  const outside = path.join(root, "plain", "folder");
  mkdirSync(outside, { recursive: true });

  it("keys a folder inside a repository by its origin remote, from any depth", () => {
    expect(repositoryKeyOf(withRemote, null)).toBe("github.com/org/app");
    expect(repositoryKeyOf(path.join(withRemote, "src", "deep"), null)).toBe("github.com/org/app");
  });

  it("takes the first remote when there is no origin", () => {
    expect(repositoryKeyOf(firstRemote, null)).toBe("example.org/a/b");
  });

  it("follows a worktree's gitdir and commondir to the main repository", () => {
    expect(repositoryKeyOf(worktree, null)).toBe("github.com/org/app");
    expect(repositoryKeyOf(localWorktree, null)).toBe(`local:${noRemote}`);
  });

  it("keys a repository without a remote by its main root", () => {
    expect(repositoryKeyOf(noRemote, null)).toBe(`local:${noRemote}`);
  });

  it("keys an existing folder outside any repository by its path", () => {
    expect(repositoryKeyOf(outside, "github.com/ignored/when-folder-exists")).toBe(`path:${outside}`);
  });

  it("uses the recorded repository only when the folder is gone", () => {
    const gone = path.join(root, "gone");
    expect(repositoryKeyOf(gone, "https://github.com/Org/Gone.git")).toBe("github.com/org/gone");
    expect(repositoryKeyOf(gone, "Org/Gone")).toBe("repository:Org/Gone");
    expect(repositoryKeyOf(gone, "just words")).toBe(`path:${gone}`);
    expect(repositoryKeyOf(gone, null)).toBe(`path:${gone}`);
  });

  it("leaves a session without a folder unattributed", () => {
    expect(repositoryKeyOf(null, null)).toBeNull();
    expect(repositoryKeyOf(null, "github.com/org/app")).toBeNull();
  });

  it("redacts local and path keys to the folder name, as every answer shows them", () => {
    expect(redactKey(`local:${noRemote}`)).toBe("local:local-one");
    expect(redactKey(`path:${outside}`)).toBe("path:folder");
    expect(redactKey("github.com/org/app")).toBe("github.com/org/app");
  });
});

describe("projectOf (plan §7, whole-repository members)", () => {
  const projects = [
    { id: "a", members: [{ repository: "github.com/org/app" }] },
    { id: "b", members: [{ repository: "local:/x/y" }] },
  ];
  it("puts a repository's turns in the project that lists it, else none; aliases first", () => {
    expect(projectOf("github.com/org/app", projects, {})).toBe("a");
    expect(projectOf("path:/old", projects, { "path:/old": "local:/x/y" })).toBe("b");
    expect(projectOf("github.com/other", projects, {})).toBeNull();
    expect(projectOf(null, projects, {})).toBeNull();
  });
});

const book: BookVersion[] = [
  {
    id: "anthropic-api:m:2026-01-01",
    channel: "anthropic-api",
    modelId: "claude-opus-5.5",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-10-01",
    kind: "list",
    tiers: [{ inputUsdPerM: 10, cachedInputUsdPerM: 1, cacheWriteUsdPerM: 12.5, extendedCacheWriteUsdPerM: 20, outputUsdPerM: 50 }],
  },
  {
    id: "anthropic-api:m:2026-10-01",
    channel: "anthropic-api",
    modelId: "claude-opus-5.5",
    effectiveFrom: "2026-10-01",
    kind: "list",
    tiers: [{ inputUsdPerM: 5, cachedInputUsdPerM: 0.5, cacheWriteUsdPerM: 6.25, extendedCacheWriteUsdPerM: 10, outputUsdPerM: 25 }],
  },
  {
    id: "anthropic-api:h:2026-10-07",
    channel: "anthropic-api",
    modelId: "claude-haiku-5.5",
    effectiveFrom: "2026-10-07",
    kind: "list",
    tiers: [
      { maxInputTokens: 200_000, inputUsdPerM: 1, cachedInputUsdPerM: 0.1, cacheWriteUsdPerM: 1.25, extendedCacheWriteUsdPerM: 2, outputUsdPerM: 5 },
      { inputUsdPerM: 2, cachedInputUsdPerM: 0.2, cacheWriteUsdPerM: 2.5, extendedCacheWriteUsdPerM: 4, outputUsdPerM: 10 },
    ],
  },
  {
    id: "github-copilot:g:2026-10-01",
    channel: "github-copilot",
    modelId: "gpt-5.6-luna",
    effectiveFrom: "2026-10-01",
    kind: "list",
    tiers: [{ inputUsdPerM: 2, cachedInputUsdPerM: 0.2, cacheWriteUsdPerM: null, outputUsdPerM: 8 }],
  },
  {
    id: "anthropic-api:contract",
    channel: "anthropic-api",
    modelId: "claude-opus-5.5",
    effectiveFrom: "2026-01-01",
    kind: "contract",
    tiers: [{ inputUsdPerM: 99, cachedInputUsdPerM: 99, cacheWriteUsdPerM: 99, outputUsdPerM: 99 }],
  },
];

describe("versionAt (plan §6.2: the list version in force at the turn's time)", () => {
  it("takes [effectiveFrom, effectiveTo) and maps the log's model spelling", () => {
    expect(versionAt(book, "anthropic-api", "claude-opus-5-5", "2026-09-30T23:59:59Z")).toMatchObject({ known: true, version: { id: "anthropic-api:m:2026-01-01" } });
    expect(versionAt(book, "anthropic-api", "claude-opus-5-5-20261001", "2026-10-01T00:00:00Z")).toMatchObject({ known: true, version: { id: "anthropic-api:m:2026-10-01" } });
  });

  it("is unknown before the first version, for an unpriced model, and without a model", () => {
    expect(versionAt(book, "anthropic-api", "claude-haiku-5-5", "2026-10-06T23:00:00Z").known).toBe(false);
    expect(versionAt(book, "anthropic-api", "claude-fable-5-2", "2026-10-10T00:00:00Z").known).toBe(false);
    expect(versionAt(book, "anthropic-api", null, "2026-10-10T00:00:00Z").known).toBe(false);
  });
});

type PartOver = Partial<OracleTurn["parts"][number]>;
const turn = (over: Partial<OracleTurn> & PartOver = {}): OracleTurn => {
  const { model = "claude-opus-5-5", requests = 1, tokens = { uncached: 1_000_000, cacheRead: 2_000_000, cacheWrite: 300_000, cacheWrite1h: null, output: 100_000 }, ...rest } = over;
  return {
    provider: "claude-code",
    session: "s",
    turnKey: "s#0",
    at: "2026-10-10T10:00:00Z",
    folder: "/f",
    recordedRepository: null,
    channel: "anthropic-api",
    parts: [{ model, requests, tokens }],
    billed: undefined,
    reported: undefined,
    ...rest,
  };
};

describe("pricedFigure (plan §5, §6.2, step 15.6 policies)", () => {
  it("prices tokens x the version in force; Claude Code's unsplit writes at the 1-hour rate", () => {
    const figure = pricedFigure(turn({}), book);
    // 1M x 5 + 2M x 0.5 + 0.3M x 10 + 0.1M x 25 = 5 + 1 + 3 + 2.5
    expect(figure).toMatchObject({ known: true, currency: "USD" });
    expect(figure.known && figure.amount).toBeCloseTo(11.5, 12);
  });

  it("uses a recorded 1-hour split, the rest at the standard write rate", () => {
    const figure = pricedFigure(turn({ tokens: { uncached: 0, cacheRead: 0, cacheWrite: 300_000, cacheWrite1h: 100_000, output: 0 } }), book);
    // 0.2M x 6.25 + 0.1M x 10
    expect(figure.known && figure.amount).toBeCloseTo(2.25, 12);
  });

  it("prices Copilot in AI Credits (1 credit = $0.01) with unknown writes inside uncached input", () => {
    const figure = pricedFigure(
      turn({ provider: "vscode", channel: "github-copilot", model: "gpt-5.6-luna", tokens: { uncached: 1_000_000, cacheRead: 1_000_000, cacheWrite: null, cacheWrite1h: null, output: 1_000_000 } }),
      book,
    );
    // (2 + 0.2 + 8) USD = 1020 AI Credits
    expect(figure).toMatchObject({ known: true, currency: "AI_CREDITS" });
    expect(figure.known && figure.amount).toBeCloseTo(1020, 9);
  });

  it("is unknown without tokens, a channel or a price, never 0", () => {
    expect(pricedFigure(turn({ tokens: null }), book).known).toBe(false);
    expect(pricedFigure(turn({ channel: null }), book).known).toBe(false);
    expect(pricedFigure(turn({ model: null, requests: 0 }), book).known).toBe(false);
    expect(pricedFigure(turn({ parts: [] }), book).known).toBe(false);
    expect(pricedFigure(turn({ provider: "claude-code", tokens: { uncached: 1, cacheRead: 0, cacheWrite: null, cacheWrite1h: null, output: 1 } }), book).known).toBe(false);
  });

  it("picks the tier by the prompt; a several-request turn past the first tier is unknown (limitation L1)", () => {
    const small = turn({ model: "claude-haiku-5-5", tokens: { uncached: 100_000, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0 } });
    expect(pricedFigure(small, book).known && (pricedFigure(small, book) as { amount: number }).amount).toBeCloseTo(0.1, 12);
    const large = turn({ model: "claude-haiku-5-5", tokens: { uncached: 300_000, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0 } });
    expect((pricedFigure(large, book) as { amount: number }).amount).toBeCloseTo(0.6, 12);
    expect(pricedFigure(turn({ model: "claude-haiku-5-5", requests: 2, tokens: large.parts[0]!.tokens }), book).known).toBe(false);
    expect(pricedFigure(turn({ model: "claude-haiku-5-5", requests: 2, tokens: small.parts[0]!.tokens }), book).known).toBe(true);
  });
});

describe("addTurn and cells (preferred = billed, else reported, else priced)", () => {
  it("sums per currency and counts known turns per basis; unknown adds no amount", () => {
    const cell = emptyCell();
    addTurn(cell, turn({ provider: "vscode", channel: "github-copilot", model: "gpt-5.6-luna", billed: 3, tokens: null }), book);
    addTurn(cell, turn({ provider: "vscode", channel: "github-copilot", model: "gpt-5.6-luna", billed: null, tokens: null }), book);
    addTurn(cell, turn({}), book);
    expect(cell.turns).toBe(3);
    expect(cell.basis.billed).toEqual({ knownTurns: 1, amounts: { AI_CREDITS: 3 } });
    expect(cell.basis.preferred.knownTurns).toBe(2);
    expect(cell.basis.preferred.amounts.AI_CREDITS).toBe(3);
    expect(cell.basis.preferred.amounts.USD).toBeCloseTo(11.5, 12);
    expect(cell.basis.reported).toEqual({ knownTurns: 0, amounts: {} });
  });

  it("dates by the turn's own UTC month", () => {
    expect(monthOf("2026-10-31T23:59:59.999Z")).toBe("2026-10");
    expect(monthOf("2026-11-01T00:00:00+02:00")).toBe("2026-10");
  });
});

const line = (o: Record<string, unknown>) => JSON.stringify(o);

describe("claudeCodeTurns (active branch, real prompts, one request per message id)", () => {
  const text = [
    line({ type: "user", uuid: "u1", parentUuid: null, timestamp: "2026-10-10T10:00:00Z", cwd: "/repo", message: { role: "user", content: "hi" } }),
    line({ type: "assistant", uuid: "a1", parentUuid: "u1", timestamp: "2026-10-10T10:00:01Z", cwd: "/repo", message: { id: "m1", model: "claude-opus-5-5", usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 30, cache_creation: { ephemeral_1h_input_tokens: 30 }, output_tokens: 5 } } }),
    line({ type: "assistant", uuid: "a2", parentUuid: "a1", timestamp: "2026-10-10T10:00:02Z", cwd: "/repo", message: { id: "m1", model: "claude-opus-5-5", usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 30, cache_creation: { ephemeral_1h_input_tokens: 30 }, output_tokens: 5 } } }),
    line({ type: "user", uuid: "t1", parentUuid: "a2", timestamp: "2026-10-10T10:00:03Z", cwd: "/repo", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x" }] } }),
    line({ type: "assistant", uuid: "a3", parentUuid: "t1", timestamp: "2026-10-10T10:00:04Z", cwd: "/repo", message: { id: "m2", model: "claude-sonnet-5-5", usage: { input_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 0, output_tokens: 3 } } }),
    line({ type: "user", uuid: "meta", parentUuid: "a3", isMeta: true, timestamp: "2026-10-10T10:00:05Z", cwd: "/repo", message: { role: "user", content: "caveat" } }),
    line({ type: "user", uuid: "u2", parentUuid: "meta", timestamp: "2026-11-01T00:00:00Z", cwd: "/other", message: { role: "user", content: "/local command" } }),
    line({ type: "assistant", uuid: "s1", parentUuid: "u2", timestamp: "2026-11-01T00:00:01Z", message: { id: "m3", model: "<synthetic>", usage: { input_tokens: 0, output_tokens: 0 } } }),
    // A fork the active branch does not take.
    line({ type: "user", uuid: "f1", parentUuid: "a3", timestamp: "2026-10-10T11:00:00Z", cwd: "/repo", message: { role: "user", content: "abandoned" } }),
    line({ type: "last-prompt", leafUuid: "s1" }),
  ].join("\n");

  it("groups two turns on the active branch with summed, deduplicated usage", () => {
    const { turns, prompts } = claudeCodeTurns(text, "file.jsonl");
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({
      at: "2026-10-10T10:00:00Z",
      folder: "/repo",
      channel: "anthropic-api",
      parts: [{ model: "claude-sonnet-5-5", requests: 2, tokens: { uncached: 11, cacheRead: 22, cacheWrite: 30, cacheWrite1h: 30, output: 8 } }],
    });
    expect(turns[1]).toMatchObject({ folder: "/other", parts: [{ model: null, requests: 0, tokens: { uncached: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0 } }] });
    expect(prompts).toEqual(["hi", "/local command"]);
  });
});

describe("piTurns (pi's own cost as reported, its provider as the channel)", () => {
  const text = [
    line({ type: "session", id: "h", timestamp: "2026-10-01T00:00:00Z", cwd: "/pi" }),
    line({ type: "model_change", id: "mc", parentId: null }),
    line({ type: "message", id: "u1", parentId: "mc", timestamp: "2026-10-01T00:00:01Z", message: { role: "user", content: "hello" } }),
    line({ type: "message", id: "a1", parentId: "u1", message: { role: "assistant", provider: "anthropic", model: "claude-opus-5-5", usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cost: { total: 0.5 } } } }),
    line({ type: "message", id: "a2", parentId: "a1", message: { role: "assistant", provider: "anthropic", model: "claude-opus-5-5", usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 0, cost: { total: 0.25 } } } }),
    line({ type: "message", id: "u2", parentId: "a2", timestamp: "2026-10-02T00:00:00Z", message: { role: "user", content: [{ type: "text", text: "next" }] } }),
    line({ type: "message", id: "a3", parentId: "u2", message: { role: "assistant", provider: "llamacpp", model: "local:x", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } } }),
  ].join("\n");

  it("sums every usage in a turn and its reported cost; unknown when any usage lacks one", () => {
    const { turns } = piTurns(text, "f.jsonl");
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ folder: "/pi", reported: 0.75, channel: "anthropic-api", parts: [{ requests: 2, tokens: { uncached: 2, cacheRead: 6, cacheWrite: 4, output: 4 } }] });
    expect(turns[1]).toMatchObject({ reported: null, channel: null, parts: [{ model: "local:x" }] });
  });
});

describe("inChatPanelScope (§15.2: store sessions are selected by surface, owner decision 2026-11-14)", () => {
  it("keeps a Chat-panel session whatever agent name the store took from one request", () => {
    expect(inChatPanelScope({ host_type: "vscode", agent_name: "panel/editAgent" })).toBe(true);
    expect(inChatPanelScope({ host_type: "vscode", agent_name: "summarizeConversationHistory" })).toBe(true);
  });
  it("keeps the legacy agent-name match", () => {
    expect(inChatPanelScope({ host_type: null, agent_name: "GitHub Copilot Chat" })).toBe(true);
  });
  it("leaves out the CLI, the Coding Agent and subagents", () => {
    expect(inChatPanelScope({ host_type: "cli", agent_name: "copilot-cli" })).toBe(false);
    expect(inChatPanelScope({ host_type: null, agent_name: null })).toBe(false);
  });
});

describe("alignLogTurns (the debug log's prompts onto the store's turns)", () => {
  it("uses the one offset where every prompt agrees", () => {
    expect(alignLogTurns(["b", "c"], ["a", "b", "c"])).toEqual([1, 2]);
  });
  it("trusts the position when the counts agree but no single offset does", () => {
    expect(alignLogTurns(["x", "y"], ["a", "b"])).toEqual([0, 1]);
  });
  it("places nothing when it can't tell", () => {
    expect(alignLogTurns(["x"], ["a", "b"])).toEqual([null]);
  });
  it("continues past the store's last turn", () => {
    expect(alignLogTurns(["b", "c"], ["a", "b"])).toEqual([1, 2]);
  });
});

describe("copilotClassicTurns (store turns, billed from the aligned log turn and its subagent runs)", () => {
  const ev = (type: string, ts: number, attrs: Record<string, unknown> = {}) => line({ type, ts, attrs });
  const main = [
    ev("user_message", 1000, { content: "first" }),
    ev("llm_request", 1100, { model: "gpt-5.6-luna", inputTokens: 100, cachedTokens: 40, outputTokens: 10, copilotUsageNanoAiu: 2_000_000_000 }),
    ev("child_session_ref", 1150, { childLogFile: "runSubagent-a.jsonl" }),
    ev("llm_request", 1200, { model: "gpt-5.6-luna", inputTokens: 50, outputTokens: 5, copilotUsageNanoAiu: 1_000_000_000 }),
    ev("user_message", 2000, { content: "second" }),
    ev("llm_request", 2100, { model: "gpt-5.6-luna", inputTokens: 10, outputTokens: 1 }),
  ].join("\n");
  const sub = [ev("llm_request", 1160, { model: "gpt-5.6-luna", inputTokens: 7, outputTokens: 1, copilotUsageNanoAiu: 500_000_000 })].join("\n");

  it("counts a log turn past the store's last row as a turn of its own, timed at the session's start", () => {
    const { turns } = copilotClassicTurns({
      session: { id: "s", cwd: "/w", repository: null, created_at: "2026-10-01T00:00:00Z" },
      storeTurns: [{ turn_index: 0, user_message: "first", timestamp: "2026-10-01T00:00:01Z" }],
      mainText: main,
      subagentFiles: [{ name: "runSubagent-a.jsonl", text: sub }],
    });
    expect(turns.map((t) => t.turnKey)).toEqual(["s#0", "s#1"]);
    expect(turns[1]).toMatchObject({ at: "2026-10-01T00:00:00Z", parts: [{ requests: 1 }], billed: null });
  });
  it("folds runs into their turn and leaves a turn without credits unknown", () => {
    const { turns } = copilotClassicTurns({
      session: { id: "s", cwd: "/w", repository: null, created_at: "2026-10-01T00:00:00Z" },
      storeTurns: [
        { turn_index: 0, user_message: "first", timestamp: "2026-10-01T00:00:01Z" },
        { turn_index: 1, user_message: "second", timestamp: "2026-10-01T00:00:02Z" },
        { turn_index: 2, user_message: "third", timestamp: null },
      ],
      mainText: main,
      subagentFiles: [{ name: "runSubagent-a.jsonl", text: sub }],
    });
    expect(turns).toHaveLength(3);
    expect(turns[0]).toMatchObject({
      at: "2026-10-01T00:00:01Z",
      billed: 3.5,
      parts: [
        { model: "gpt-5.6-luna", requests: 2, tokens: { uncached: 110, cacheRead: 40, output: 15, cacheWrite: null } },
        { model: "gpt-5.6-luna", requests: 1, tokens: { uncached: 7, cacheRead: 0, output: 1, cacheWrite: null } },
      ],
    });
    expect(turns[1]).toMatchObject({ billed: null, parts: [{ requests: 1 }] });
    expect(turns[2]).toMatchObject({ at: "2026-10-01T00:00:00Z", billed: null, parts: [] });
  });
});

describe("agentHostCatalogIdOf (a Copilot CLI catalog row's session id)", () => {
  const ID = "3f2a9c10-1111-4a1b-8c01-aaaaaaaaaaa1";

  it("is the path after copilotcli:/ (the storage uri) or ahp-session:/ (the runtime uri)", () => {
    expect(agentHostCatalogIdOf(`copilotcli:/${ID}`)).toBe(ID);
    expect(agentHostCatalogIdOf(`ahp-session:/${ID}`)).toBe(ID);
  });

  it("is null under another scheme, without the slash, or for an id that is no one safe path segment", () => {
    for (const uri of [`claude:/${ID}`, `ahp-chat:/${ID}`, `copilotcliX:/${ID}`, `copilotcli:${ID}`, "copilotcli:/", "ahp-session:/", "ahp-session:/a/b", "copilotcli:/../x", "copilotcli:/-a", ID]) {
      expect(agentHostCatalogIdOf(uri), uri).toBeNull();
    }
  });
});

describe("agentHostCatalogSessions (one session per id, tombstones under either uri)", () => {
  const row = (session_uri: string, start_time = 1) => ({ session_uri, start_time });

  it("keeps each accepted row with its id, in the rows' order, and drops the rest", () => {
    const rows = [row("ahp-session:/b", 2), row("copilotcli:/a", 1), row("claude:/c"), row("copilotcli:/")];
    expect(agentHostCatalogSessions(rows, new Set())).toEqual([
      { id: "b", row: rows[0] },
      { id: "a", row: rows[1] },
    ]);
  });

  it("reads an id cataloged under both uris once, from its copilotcli:/ row", () => {
    const runtime = row("ahp-session:/a", 9);
    const storage = row("copilotcli:/a", 1);
    expect(agentHostCatalogSessions([runtime, storage], new Set())).toEqual([{ id: "a", row: storage }]);
    expect(agentHostCatalogSessions([storage, runtime], new Set())).toEqual([{ id: "a", row: storage }]);
  });

  it("drops a session tombstoned under either of its uris", () => {
    const rows = [row("copilotcli:/a"), row("ahp-session:/b"), row("copilotcli:/c"), row("ahp-session:/c"), row("copilotcli:/d")];
    const tombstones = new Set(["sessionTombstone:ahp-session:/a", "sessionTombstone:copilotcli:/b", "sessionTombstone:ahp-session:/c", "sessionTombstone:claude:/d"]);
    expect(agentHostCatalogSessions(rows, tombstones).map((s) => s.id)).toEqual(["d"]);
  });
});

describe("agentHostTurns (VS Code's Agent Host: session.db turns, the CLI's event log for times and writes)", () => {
  const usage = (o: Record<string, unknown>) => JSON.stringify(o);
  const ev = (id: string, type: string, timestamp: string, data: Record<string, unknown> = {}, agentId: string | null = null) => ({ id, type, timestamp, agentId, data });
  const record = (input: number, read: number, output: number, write?: number) => ({
    usage: { inputTokens: input, cacheReadTokens: read, outputTokens: output, ...(write !== undefined ? { cacheWriteTokens: write } : {}) },
  });
  const events = [
    ev("s", "session.start", "2026-10-01T00:00:00Z"),
    ev("u1", "user.message", "2026-10-01T10:00:00Z", { content: "first" }),
    ev("r1", "session.usage_record", "2026-10-01T10:00:01Z", record(100, 40, 10, 20)),
    ev("r2", "session.usage_record", "2026-10-01T10:00:02Z", record(50, 0, 5, 0)),
    ev("sub", "user.message", "2026-10-01T10:00:03Z", { content: "subagent prompt" }, "agent-1"),
    ev("u2", "user.message", "2026-11-01T00:00:00Z", { content: "second" }),
    ev("r3", "session.usage_record", "2026-11-01T00:00:01Z", record(10, 0, 1)),
  ];
  const session = { id: "h", startedAt: "2026-10-01T00:00:00.000Z", folder: "/w" };

  it("dates a turn by its user.message, sums its totals and takes writes when the records cover the turn", () => {
    const { turns, prompts } = agentHostTurns({
      session,
      storeTurns: [
        {
          id: "request_1",
          event_id: "u1",
          usage: usage({
            model: "gpt-5.6-luna",
            _meta: {
              turnTokenTotals: [
                { inputTokens: 100, cachedTokens: 40, outputTokens: 10 },
                { inputTokens: 50, cachedTokens: 0, outputTokens: 5 },
              ],
              copilotUsage: { totalNanoAiu: 3_000_000_000 },
            },
          }),
        },
        { id: "request_2", event_id: "u2", usage: usage({ _meta: { turnTokenTotals: [{ model: "claude-sonnet-5", inputTokens: 10, cachedTokens: 0, outputTokens: 1 }] } }) },
        { id: "request_3", event_id: "missing", usage: null },
      ],
      events,
    });
    expect(turns).toHaveLength(3);
    expect(turns[0]).toMatchObject({
      provider: "vscode",
      at: "2026-10-01T10:00:00Z",
      folder: "/w",
      channel: "github-copilot",
      billed: 3,
      parts: [{ model: "gpt-5.6-luna", tokens: { uncached: 90, cacheRead: 40, cacheWrite: 20, output: 15 } }],
    });
    // r3 reports no writes: unknown, and uncached keeps them.
    expect(turns[1]).toMatchObject({ at: "2026-11-01T00:00:00Z", billed: null, parts: [{ model: "claude-sonnet-5", tokens: { uncached: 10, cacheRead: 0, cacheWrite: null, output: 1 } }] });
    // Not in the log, no usage row: the session's start, nothing known.
    expect(turns[2]).toMatchObject({ at: "2026-10-01T00:00:00.000Z", billed: null, parts: [{ model: null, tokens: null }] });
    expect(prompts).toEqual(["first", "second"]);
  });

  it("leaves writes unknown when the records don't add up to the turn's totals, or without a log", () => {
    const storeTurns = [{ id: "request_1", event_id: "u1", usage: usage({ model: "m", _meta: { turnTokenTotals: [{ inputTokens: 999, cachedTokens: 40, outputTokens: 10 }] } }) }];
    expect(agentHostTurns({ session, storeTurns, events }).turns[0]!.parts[0]!.tokens).toMatchObject({ uncached: 959, cacheWrite: null });
    expect(agentHostTurns({ session, storeTurns, events: null }).turns[0]).toMatchObject({ at: "2026-10-01T00:00:00.000Z", parts: [{ tokens: { cacheWrite: null } }] });
  });
});

describe("claudeCodeTurns with subagent runs (C15: a turn holds the runs its Agent calls started)", () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });
  const usage = (n: number) => ({ input_tokens: n, cache_read_input_tokens: 2 * n, cache_creation_input_tokens: 3 * n, cache_creation: { ephemeral_1h_input_tokens: 3 * n }, output_tokens: 4 * n });
  const sessionText = [
    line({ type: "user", uuid: "u1", parentUuid: null, timestamp: "2026-10-10T10:00:00Z", cwd: "/repo", message: { role: "user", content: "go" } }),
    line({ type: "assistant", uuid: "a1", parentUuid: "u1", timestamp: "2026-10-10T10:00:01Z", message: { id: "m1", model: "claude-opus-5-5", content: [{ type: "tool_use", id: "call-1", name: "Agent", input: {} }], usage: usage(1) } }),
    line({ type: "user", uuid: "u2", parentUuid: "a1", timestamp: "2026-10-10T11:00:00Z", cwd: "/repo", message: { role: "user", content: "next" } }),
    line({ type: "assistant", uuid: "a2", parentUuid: "u2", timestamp: "2026-10-10T11:00:01Z", message: { id: "m2", model: "claude-opus-5-5", usage: usage(2) } }),
  ].join("\n");
  const project = (withRun: boolean): string => {
    const root = mkdtempSync(path.join(tmpdir(), "cbp-runs-"));
    roots.push(root);
    writeFileSync(path.join(root, "s.jsonl"), sessionText);
    if (withRun) {
      const dir = path.join(root, "s", "subagents");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "agent-aaa.meta.json"), JSON.stringify({ toolUseId: "call-1" }));
      // Runs after the next prompt, on another model; its third round repeats the session's first.
      writeFileSync(
        path.join(dir, "agent-aaa.jsonl"),
        [
          line({ type: "assistant", uuid: "r1", timestamp: "2026-10-10T11:30:00Z", requestId: "q1", message: { id: "x1", model: "claude-haiku-5-5", usage: usage(5) } }),
          line({ type: "assistant", uuid: "r2", timestamp: "2026-10-10T11:30:05Z", requestId: "q2", message: { id: "x2", model: "claude-haiku-5-5", usage: usage(7) } }),
          line({ type: "assistant", uuid: "r3", timestamp: "2026-10-10T11:30:09Z", requestId: "q3", message: { id: "m1", model: "claude-opus-5-5", usage: usage(1) } }),
        ].join("\n"),
      );
    }
    return path.join(root, "s.jsonl");
  };

  it("adds one part per run to the turn that made the call, on the run's own model, each round once", () => {
    const { turns } = claudeCodeTurns(sessionText, project(true));
    expect(turns[0]!.parts).toEqual([
      { model: "claude-opus-5-5", requests: 1, tokens: { uncached: 1, cacheRead: 2, cacheWrite: 3, cacheWrite1h: 3, output: 4 } },
      { model: "claude-haiku-5-5", requests: 2, tokens: { uncached: 12, cacheRead: 24, cacheWrite: 36, cacheWrite1h: 36, output: 48 } },
    ]);
    expect(turns[1]!.parts).toHaveLength(1);
  });

  it("makes the turn's cost unknown when the call has no run, never a smaller known figure", () => {
    const { turns } = claudeCodeTurns(sessionText, project(false));
    expect(turns[0]!.parts.some((part) => part.tokens === null)).toBe(true);
    expect(turns[1]!.parts.every((part) => part.tokens !== null)).toBe(true);
  });

  it("puts a session-level reason (a transcript no turn window holds) on the session's first turn", () => {
    const file = project(true);
    const dir = path.join(path.dirname(file), "s", "subagents");
    writeFileSync(path.join(dir, "agent-zzz.jsonl"), line({ type: "assistant", uuid: "z1", timestamp: "2026-10-09T10:00:00Z", requestId: "qz", message: { id: "xz", model: "claude-haiku-5-5", usage: usage(1) } }));
    const { turns } = claudeCodeTurns(sessionText, file);
    expect(turns[0]!.parts.some((part) => part.tokens === null)).toBe(true);
    expect(turns[1]!.parts.every((part) => part.tokens !== null)).toBe(true);
  });
});

describe("pricedParts (each cost line explained on its own, 10.19)", () => {
  const known = { uncached: 1_000_000, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0 };
  const parts = [
    { model: "claude-opus-5-5", requests: 1, tokens: known },
    { model: "claude-opus-5-5", requests: 1, tokens: null },
    { model: "claude-opus-5-5", requests: 1, tokens: known },
  ];
  it("keeps the known parts' amounts and counts the unknown ones; the whole turn is unknown", () => {
    const t = turn({ parts });
    const one = pricedFigure(turn({ parts: [parts[0]!] }), book);
    expect(one.known).toBe(true);
    const amount = one.known ? one.amount : 0;
    expect(pricedParts(t, book)).toEqual({ known: [{ amount, currency: "USD" }, { amount, currency: "USD" }], unknown: 1 });
    expect(pricedFigure(t, book)).toEqual({ known: false });
  });
  it("counts a turn with no part or no channel as one unknown line", () => {
    expect(pricedParts(turn({ parts: [] }), book)).toEqual({ known: [], unknown: 1 });
    expect(pricedParts(turn({ channel: null }), book)).toEqual({ known: [], unknown: 1 });
  });
});
