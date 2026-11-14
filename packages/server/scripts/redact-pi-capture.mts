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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deriveContext, redactCapture } from "./redact-pi-capture-lib.mjs";

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

  const result = await redactCapture({
    sessionText,
    sessionPath: args.session,
    sidecarText: args.sidecar ? readFileSync(args.sidecar, "utf8") : undefined,
    stem,
    context: deriveContext(headerCwd, { usernames: args.mask, hostnames: args.mask }),
  });

  console.log(`Provider read: ${result.branchTurns.length} branch(es), turns per branch ${result.branchTurns.join(", ")}`);
  console.log(`Entries: ${result.report.entries}; malformed lines replaced: ${result.report.malformedLines}`);
  console.log(`Sidecar records for this session: ${result.recordCount}${args.sidecar && result.recordCount === 0 ? " (none matched)" : ""}`);
  console.log(`Free-text keys replaced: ${Object.entries(result.report.redactedKeys).map(([k, n]) => `${k}(${n})`).join(", ")}`);
  if (result.leaks.length > 0) {
    console.error(`FAILED: leak scan found ${result.leaks.join(", ")}; nothing written. Re-run with --mask <term> for the leaking term.`);
    process.exit(1);
  }
  if (result.diffs.length > 0) {
    console.error(`FAILED: the pi provider reads the redacted copy differently:\n${result.diffs.join("\n")}\nNothing written.`);
    process.exit(1);
  }

  mkdirSync(args.out, { recursive: true });
  writeFileSync(path.join(args.out, `${stem}.jsonl`), result.sessionText);
  if (result.recordCount > 0) {
    writeFileSync(path.join(args.out, `${stem}.system-prompts.jsonl`), result.sidecarText);
  }
  console.log(`Wrote ${path.join(args.out, stem)}.jsonl${result.recordCount ? " and .system-prompts.jsonl" : ""}. Leak scan clean; provider check identical.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
