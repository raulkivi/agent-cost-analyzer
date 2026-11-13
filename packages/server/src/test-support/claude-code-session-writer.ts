// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// A synthetic Claude Code session log, in the shape the provider reads
// (placeholder text only), shared by the e2e fixture home and the savings
// fixtures. One user message and one assistant message per turn.

// Claude Sonnet 5.5 as Claude Code logs it; the price book maps it to
// claude-sonnet-5.5 on anthropic-api (cache reads cut on 2026-10-07).
export const SONNET_5_5 = "claude-sonnet-5-5-20261001";
// Claude Opus 5.5 as Claude Code logs it (priced from 2026-10-01).
export const OPUS_5_5 = "claude-opus-5-5-20261001";

export interface ClaudeCodeTurn {
  at: string; // ISO time of the user message
  input: number;
  cacheWrite?: number;
  cacheRead?: number;
  output: number;
  // The model of this turn; Sonnet 5.5 unless given.
  model?: string;
}

function write(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function plusSeconds(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

// <projectsDir>/<cwd slug>/<id>.jsonl, as ~/.claude/projects holds it.
export function writeClaudeCodeSession(projectsDir: string, id: string, cwd: string, turns: ClaudeCodeTurn[]): void {
  const slug = cwd.replace(/[^A-Za-z0-9]/g, "-");
  const lines: unknown[] = [];
  let parent: string | null = null;
  turns.forEach((turn, index) => {
    const userId = `u${index}`;
    const assistantId = `a${index}`;
    lines.push({
      parentUuid: parent,
      isSidechain: false,
      promptId: `p${index}`,
      type: "user",
      message: { role: "user", content: [{ type: "text", text: `Placeholder prompt ${index + 1}.` }] },
      uuid: userId,
      timestamp: turn.at,
      permissionMode: "default",
      origin: { kind: "human" },
      userType: "external",
      entrypoint: "cli",
      cwd,
      sessionId: id,
      version: "2.1.263",
      gitBranch: "main",
    });
    lines.push({
      type: "assistant",
      parentUuid: userId,
      isSidechain: false,
      message: {
        model: turn.model ?? SONNET_5_5,
        id: `msg_${id.slice(0, 8)}_${index}`,
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Placeholder answer." }],
        usage: {
          input_tokens: turn.input,
          cache_creation_input_tokens: turn.cacheWrite ?? 0,
          cache_read_input_tokens: turn.cacheRead ?? 0,
          output_tokens: turn.output,
          output_tokens_details: { thinking_tokens: 0 },
          service_tier: "standard",
          cache_creation: { ephemeral_1h_input_tokens: turn.cacheWrite ?? 0, ephemeral_5m_input_tokens: 0 },
        },
      },
      uuid: assistantId,
      timestamp: plusSeconds(turn.at, 5),
      cwd,
      sessionId: id,
      gitBranch: "main",
    });
    parent = assistantId;
  });
  write(path.join(projectsDir, slug, `${id}.jsonl`), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
}
