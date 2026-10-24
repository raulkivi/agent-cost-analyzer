import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  classifyEnvelopesAvailability,
  classifyMainJsonlAvailability,
  readMainJsonlEnvelopes,
  readMainJsonlFile,
} from "./main-jsonl-reader.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/jsonl",
);
const sessionStartOnlyPath = path.join(fixturesDir, "session-start-only.jsonl");
const syntheticMultiEventPath = path.join(
  fixturesDir,
  "synthetic-multi-event.jsonl",
);
const missingPath = path.join(fixturesDir, "does-not-exist.jsonl");
const parseFailuresOnlyPath = path.join(fixturesDir, "parse-failures-only.jsonl");
const llmRequestSamplePath = path.join(fixturesDir, "llm-request-sample.jsonl");

describe("readMainJsonlEnvelopes", () => {
  it("returns an empty array when the file doesn't exist", async () => {
    expect(await readMainJsonlEnvelopes(missingPath)).toEqual([]);
  });

  it("parses a real captured session_start-only log", async () => {
    const envelopes = await readMainJsonlEnvelopes(sessionStartOnlyPath);

    expect(envelopes).toHaveLength(1);
    expect(envelopes[0].type).toBe("session_start");
    expect(envelopes[0].sid).toBe("2137cba5-8ad3-4f7c-9a18-f8d716ed8683");
  });

  it("defensively skips malformed and blank lines, keeping well-formed ones", async () => {
    const envelopes = await readMainJsonlEnvelopes(syntheticMultiEventPath);

    expect(envelopes.map((envelope) => envelope.type)).toEqual([
      "session_start",
      "llm_request",
      "some_future_event_type",
    ]);
  });

  // 2026-08-08 code/security review, high finding: no extractor in
  // this codebase reads any `attrs` key beyond a small known set (see the
  // KNOWN_ATTRS_KEYS allow-list) — an envelope's `attrs` can otherwise carry
  // an arbitrarily large, per-provider payload (e.g. raw prompt/tool-call
  // content) that would sit in memory for the whole file untouched.
  // Dropping unrecognized keys at parse time keeps peak memory bounded by
  // what's actually used instead of the raw log's full per-line payload.
  it("drops attrs keys no extractor reads, keeping only the known allow-list", async () => {
    const envelopes = await readMainJsonlEnvelopes(syntheticMultiEventPath);

    expect(envelopes[0].attrs).toBeUndefined();
    expect(envelopes[1].attrs).toBeUndefined();
  });

  // Agent-traces enrichment (Phase 8.5) joins main.jsonl llm_request entries
  // to agent-traces.db spans by responseId — it must survive this allow-list
  // projection like the other usage fields already do.
  it("keeps responseId, since llm-request-extractor.ts now reads it", async () => {
    const [envelope] = await readMainJsonlEnvelopes(llmRequestSamplePath);

    expect(envelope.attrs?.responseId).toBe("redacted-response-id");
  });
});

describe("readMainJsonlFile", () => {
  it("reports rawLineCount (non-blank lines seen) alongside the parsed envelopes", async () => {
    const result = await readMainJsonlFile(syntheticMultiEventPath);

    // 4 non-blank raw lines (1 blank line in the fixture is excluded), only
    // 3 of which parsed into envelopes — the malformed line is dropped from
    // `envelopes` but still counted in `rawLineCount`.
    expect(result.rawLineCount).toBe(4);
    expect(result.envelopes).toHaveLength(3);
  });

  it("returns a zero rawLineCount when the file doesn't exist", async () => {
    expect(await readMainJsonlFile(missingPath)).toEqual({
      envelopes: [],
      rawLineCount: 0,
    });
  });
});

describe("classifyMainJsonlAvailability", () => {
  it("returns 'missing' when the file doesn't exist", async () => {
    expect(await classifyMainJsonlAvailability(missingPath)).toBe("missing");
  });

  it("returns 'logging-never-enabled' when the file only has a session_start line", async () => {
    expect(await classifyMainJsonlAvailability(sessionStartOnlyPath)).toBe(
      "logging-never-enabled",
    );
  });

  it("returns 'events-present' when the file has more than one event", async () => {
    expect(await classifyMainJsonlAvailability(syntheticMultiEventPath)).toBe(
      "events-present",
    );
  });

  // 2026-08-08 code/security review, medium finding: a log with many
  // raw lines that all fail to parse must not be reported as
  // "logging-never-enabled" (that would wrongly tell the user the setting
  // was off, when really something else — a parser regression, a corrupted
  // file — produced zero usable envelopes from a non-trivial file).
  it("returns 'parse-failures' when the file has multiple raw lines but none parse into an envelope", async () => {
    expect(await classifyMainJsonlAvailability(parseFailuresOnlyPath)).toBe(
      "parse-failures",
    );
  });
});

describe("classifyEnvelopesAvailability", () => {
  it("classifies from an already-read envelope array + raw line count, without touching the filesystem", () => {
    expect(classifyEnvelopesAvailability([], 0)).toBe("logging-never-enabled");
    expect(
      classifyEnvelopesAvailability([{ type: "session_start" }], 1),
    ).toBe("logging-never-enabled");
    expect(
      classifyEnvelopesAvailability(
        [{ type: "session_start" }, { type: "llm_request" }],
        2,
      ),
    ).toBe("events-present");
  });

  it("classifies as 'parse-failures' when raw lines outnumber the parsed envelopes by more than the single session_start case", () => {
    expect(classifyEnvelopesAvailability([], 4)).toBe("parse-failures");
    expect(
      classifyEnvelopesAvailability([{ type: "session_start" }], 4),
    ).toBe("parse-failures");
  });

  it("classifies a single corrupted line (one raw line, zero parsed envelopes) as 'parse-failures', not 'logging-never-enabled'", () => {
    expect(classifyEnvelopesAvailability([], 1)).toBe("parse-failures");
  });
});
