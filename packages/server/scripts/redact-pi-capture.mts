// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Redacts one pi session file and its system-prompts.jsonl records so they can
// become Phase 11 fixtures (1.0 task V12). Rules: redact-pi-capture-lib.mts.
//
//   npm run fixtures:redact-pi -w packages/server -- <session.jsonl> \
//     [--sidecar ~/.pi/agent/logs/system-prompts.jsonl] --out <dir> \
//     [--name <stem>] [--mask <extra term>]...
//
// Writes <out>/<stem>.jsonl and <out>/<stem>.system-prompts.jsonl (only this
// session's records). Exits non-zero, writing nothing, if a leak scan or the
// provider check fails. Prints counts and key names, never captured text.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  compareSummaries,
  deriveContext,
  findLeaks,
  redactSession,
  redactSidecarRecord,
  summariseCapture,
} from "./redact-pi-capture-lib.mjs";

interface Args {
  session: string;
  sidecar?: string;
  out: string;
  name?: string;
  mask: string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = { session: "", out: "", mask: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--sidecar") args.sidecar = argv[++i];
    else if (arg === "--out") args.out = argv[++i] ?? "";
    else if (arg === "--name") args.name = argv[++i];
    else if (arg === "--mask") args.mask.push(argv[++i] ?? "");
    else if (!arg.startsWith("--") && !args.session) args.session = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.session || !args.out) {
    throw new Error("Usage: redact-pi-capture <session.jsonl> [--sidecar <file>] --out <dir> [--name <stem>] [--mask <term>]...");
  }
  return args;
}

function readSidecarRecords(file: string, sessionPath: string, headerId: string | undefined): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      const sameFile = typeof record.sessionFile === "string" && path.resolve(record.sessionFile) === path.resolve(sessionPath);
      const sameId = headerId !== undefined && record.sessionId === headerId;
      if (sameFile || sameId) records.push(record);
    } catch {
      // not a record line; skip
    }
  }
  return records;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sessionText = readFileSync(args.session, "utf8");
  const stem = args.name ?? path.basename(args.session, ".jsonl");

  const headerCwd = (() => {
    try {
      return (JSON.parse(sessionText.split("\n")[0]) as { cwd?: string }).cwd;
    } catch {
      return undefined;
    }
  })();
  const headerId = (() => {
    try {
      return (JSON.parse(sessionText.split("\n")[0]) as { id?: string }).id;
    } catch {
      return undefined;
    }
  })();
  const ctx = deriveContext(headerCwd, { usernames: args.mask, hostnames: args.mask });

  const records = args.sidecar ? readSidecarRecords(args.sidecar, args.session, headerId) : [];
  const session = redactSession(sessionText, ctx);
  const redactedRecords = records.map((r) => redactSidecarRecord(r, session.pieces, ctx, stem));
  const sidecarText = redactedRecords.map((r) => JSON.stringify(r)).join("\n") + (redactedRecords.length ? "\n" : "");

  const leaks = [...new Set([...findLeaks(session.text, ctx), ...findLeaks(sidecarText, ctx)])];
  const workDir = mkdtempSync(path.join(tmpdir(), "redact-pi-verify-"));
  let diffs: string[];
  try {
    const before = await summariseCapture(path.join(workDir, "a"), { sessionText, records });
    const after = await summariseCapture(path.join(workDir, "b"), { sessionText: session.text, records: redactedRecords });
    diffs = compareSummaries(before, after);
    console.log(`Provider read: ${before.sessions.length} branch(es), turns per branch ${before.sessions.map((s) => s.turnCount).join(", ")}`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  console.log(`Entries: ${session.report.entries}; malformed lines replaced: ${session.report.malformedLines}`);
  console.log(`Sidecar records for this session: ${records.length}${args.sidecar && records.length === 0 ? " (none matched)" : ""}`);
  console.log(`Free-text keys replaced: ${Object.entries(session.report.redactedKeys).map(([k, n]) => `${k}(${n})`).join(", ")}`);
  if (leaks.length > 0) {
    console.error(`FAILED: leak scan found ${leaks.join(", ")}; nothing written. Re-run with --mask <term> for the leaking term.`);
    process.exit(1);
  }
  if (diffs.length > 0) {
    console.error(`FAILED: the pi provider reads the redacted copy differently:\n${diffs.join("\n")}\nNothing written.`);
    process.exit(1);
  }

  mkdirSync(args.out, { recursive: true });
  writeFileSync(path.join(args.out, `${stem}.jsonl`), session.text);
  if (redactedRecords.length > 0) {
    writeFileSync(path.join(args.out, `${stem}.system-prompts.jsonl`), sidecarText);
  }
  console.log(`Wrote ${path.join(args.out, stem)}.jsonl${redactedRecords.length ? " and .system-prompts.jsonl" : ""}. Leak scan clean; provider check identical.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
