import { describe, expect, it } from "vitest";
import { JsonlFileSink } from "../../src/adapters/JsonlFileSink.js";
import type { FileSystemPort } from "../../src/ports/FileSystemPort.js";
import type { SystemPromptRecord } from "../../src/domain/SystemPromptRecord.js";

class FakeFileSystem implements FileSystemPort {
  readonly mkdirCalls: string[] = [];
  readonly appended: { path: string; data: string }[] = [];

  async mkdir(dirPath: string): Promise<unknown> {
    this.mkdirCalls.push(dirPath);
    return undefined;
  }

  async appendFile(filePath: string, data: string): Promise<void> {
    this.appended.push({ path: filePath, data });
  }
}

function sampleRecord(): SystemPromptRecord {
  return {
    sessionId: "session-1",
    capturedAt: "2026-09-03T10:00:00.000Z",
    cwd: "/repo",
    systemPromptChars: 4,
    systemPrompt: "test",
  };
}

describe("JsonlFileSink", () => {
  it("ensures the parent directory exists before writing", async () => {
    const fs = new FakeFileSystem();
    const sink = new JsonlFileSink(
      "/home/dev/.pi/agent/logs/system-prompts.jsonl",
      fs,
    );

    await sink.write(sampleRecord());

    expect(fs.mkdirCalls).toContain("/home/dev/.pi/agent/logs");
  });

  it("appends exactly one newline-terminated JSON line per record", async () => {
    const fs = new FakeFileSystem();
    const sink = new JsonlFileSink(
      "/home/dev/.pi/agent/logs/system-prompts.jsonl",
      fs,
    );

    await sink.write(sampleRecord());

    expect(fs.appended).toHaveLength(1);
    expect(fs.appended[0].path).toBe(
      "/home/dev/.pi/agent/logs/system-prompts.jsonl",
    );
    expect(fs.appended[0].data.endsWith("\n")).toBe(true);
    expect(JSON.parse(fs.appended[0].data)).toEqual(sampleRecord());
  });

  it("appends a separate line for each subsequent write", async () => {
    const fs = new FakeFileSystem();
    const sink = new JsonlFileSink(
      "/home/dev/.pi/agent/logs/system-prompts.jsonl",
      fs,
    );

    await sink.write(sampleRecord());
    await sink.write({ ...sampleRecord(), sessionId: "session-2" });

    expect(fs.appended).toHaveLength(2);
    expect(JSON.parse(fs.appended[1].data).sessionId).toBe("session-2");
  });
});
