import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  readSystemPromptText,
  readToolDefinitionNames,
  readToolDefinitionsRaw,
} from "./prompt-artifact-reader.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/jsonl",
);

describe("readSystemPromptText", () => {
  it("concatenates every text-typed entry's content from the referenced system-prompt file", async () => {
    const text = await readSystemPromptText(fixturesDir, "system_prompt_0.json");

    expect(text).toContain("You are an expert AI programming assistant");
  });

  it("returns null when the file does not exist", async () => {
    const text = await readSystemPromptText(fixturesDir, "system_prompt_missing.json");

    expect(text).toBeNull();
  });

  it("returns null when the file's content is not the expected shape", async () => {
    const text = await readSystemPromptText(fixturesDir, "system_prompt_malformed.json");

    expect(text).toBeNull();
  });

  it("returns null instead of reading when the file name contains a path separator, even if the traversal resolves back inside the directory", async () => {
    // path.join collapses "sub/../system_prompt_0.json" to a legitimate
    // read of system_prompt_0.json, so this would succeed unless the
    // allow-list rejects the separator itself, before any path.join call.
    const text = await readSystemPromptText(
      fixturesDir,
      "sub/../system_prompt_0.json",
    );

    expect(text).toBeNull();
  });

  it("returns null instead of reading when the file name is a bare '..' segment", async () => {
    const text = await readSystemPromptText(fixturesDir, "..");

    expect(text).toBeNull();
  });
});

describe("readToolDefinitionNames", () => {
  it("extracts every tool's name from the referenced tools file", async () => {
    const names = await readToolDefinitionNames(fixturesDir, "tools_0.json");

    expect(names).toEqual([
      "create_file",
      "read_file",
      "run_in_terminal",
      "manage_todo_list",
    ]);
  });

  it("returns null when the file does not exist", async () => {
    const names = await readToolDefinitionNames(fixturesDir, "tools_missing.json");

    expect(names).toBeNull();
  });

  it("returns null when the file's content is not valid JSON", async () => {
    const names = await readToolDefinitionNames(fixturesDir, "tools_malformed.json");

    expect(names).toBeNull();
  });

  it("returns null instead of reading when the file name contains a path separator, even if the traversal resolves back inside the directory", async () => {
    const names = await readToolDefinitionNames(
      fixturesDir,
      "sub/../tools_0.json",
    );

    expect(names).toBeNull();
  });

  it("returns null instead of reading when the file name is a bare '..' segment", async () => {
    const names = await readToolDefinitionNames(fixturesDir, "..");

    expect(names).toBeNull();
  });
});

describe("readToolDefinitionsRaw", () => {
  it("returns the full tool-definition entries (not just names) from the referenced tools file", async () => {
    const entries = await readToolDefinitionsRaw(fixturesDir, "tools_0.json");

    expect(entries).not.toBeNull();
    expect(entries).toHaveLength(4);
    expect(entries?.[0]).toMatchObject({ name: "create_file" });
  });

  it("returns null when the file does not exist", async () => {
    const entries = await readToolDefinitionsRaw(fixturesDir, "tools_missing.json");

    expect(entries).toBeNull();
  });

  it("returns null instead of reading when the file name contains a path separator", async () => {
    const entries = await readToolDefinitionsRaw(fixturesDir, "sub/../tools_0.json");

    expect(entries).toBeNull();
  });
});
