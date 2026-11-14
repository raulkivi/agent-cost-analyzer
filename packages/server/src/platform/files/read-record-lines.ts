// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { createReadStream } from "node:fs";

export interface ReadRecordLinesOptions {
  highWaterMark?: number;
}

// Yields the lines of a JSONL/log file, split at "\n" only. A "\r" before the
// "\n" is dropped. node:readline also splits at U+2028, U+2029 and a lone "\r",
// which JSON.stringify leaves raw inside strings, so it tears records in two.
// Blank lines are yielded (callers skip them); the text after the last "\n" is
// yielded when non-empty. Rejects with the stream's error (e.g. ENOENT); breaking
// out of the loop destroys the stream.
export async function* readRecordLines(
  filePath: string,
  options: ReadRecordLinesOptions = {},
): AsyncGenerator<string, void, undefined> {
  const stream = createReadStream(filePath, {
    encoding: "utf8",
    highWaterMark: options.highWaterMark,
  });
  let carry = "";
  for await (const chunk of stream as AsyncIterable<string>) {
    const parts = (carry + chunk).split("\n");
    carry = parts.pop() ?? "";
    for (const part of parts) {
      yield stripTrailingCarriageReturn(part);
    }
  }
  const last = stripTrailingCarriageReturn(carry);
  if (last !== "") {
    yield last;
  }
}

const stripTrailingCarriageReturn = (line: string): string =>
  line.endsWith("\r") ? line.slice(0, -1) : line;
