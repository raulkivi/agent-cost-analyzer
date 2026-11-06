// Reduces a past Claude Code session log to a numbers-only calibration
// capture (step 13.5a): token counts and gaps, never any text.
//   tsx scripts/extract-claude-code-capture.mts <session.jsonl> <captureId> <modelId> [outFile]
import { writeFileSync } from "node:fs";
import { readClaudeCodeSessionFile } from "../src/data-sources/claude-code/claude-code-jsonl-reader.ts";
import { extractClaudeCodeCapture } from "../src/services/learn-simulation/calibration/extract-claude-code-capture.ts";

const [file, id, modelId, outFile] = process.argv.slice(2);
if (!file || !id || !modelId) {
  console.error("Usage: extract-claude-code-capture.mts <session.jsonl> <captureId> <modelId> [outFile]");
  process.exit(2);
}
const { entries } = await readClaudeCodeSessionFile(file);
const capture = extractClaudeCodeCapture(entries, { id, modelId });
const json = `${JSON.stringify(capture, null, 2)}\n`;
if (outFile) writeFileSync(outFile, json);
else process.stdout.write(json);
