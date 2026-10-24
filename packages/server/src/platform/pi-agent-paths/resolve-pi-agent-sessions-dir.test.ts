import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listPiAgentSessionFiles, resolvePiAgentSessionsDir } from "./resolve-pi-agent-sessions-dir.js";

describe("resolvePiAgentSessionsDir", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(path.join(tmpdir(), "pi-agent-paths-"));
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("returns null when ~/.pi/agent/sessions does not exist", () => {
    expect(resolvePiAgentSessionsDir({ homeDir })).toBeNull();
  });

  it("returns the sessions dir when it exists", () => {
    const sessionsDir = path.join(homeDir, ".pi", "agent", "sessions");
    mkdirSync(sessionsDir, { recursive: true });

    expect(resolvePiAgentSessionsDir({ homeDir })).toBe(sessionsDir);
  });
});

describe("listPiAgentSessionFiles", () => {
  let sessionsDir: string;

  beforeEach(() => {
    sessionsDir = mkdtempSync(path.join(tmpdir(), "pi-agent-sessions-"));
  });

  afterEach(() => {
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  it("returns an empty array when the sessions dir does not exist", () => {
    expect(listPiAgentSessionFiles(path.join(sessionsDir, "missing"))).toEqual([]);
  });

  it("finds .jsonl files nested under any --<project>-- subdirectory", () => {
    const projectDir = path.join(sessionsDir, "--home-user-my-project--");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(path.join(projectDir, "20260101_abc.jsonl"), "");
    writeFileSync(path.join(projectDir, "not-a-session.txt"), "");

    const files = listPiAgentSessionFiles(sessionsDir);

    expect(files).toEqual([path.join(projectDir, "20260101_abc.jsonl")]);
  });

  it("collects files across multiple project subdirectories, sorted", () => {
    const projectA = path.join(sessionsDir, "--project-a--");
    const projectB = path.join(sessionsDir, "--project-b--");
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });
    writeFileSync(path.join(projectB, "2_b.jsonl"), "");
    writeFileSync(path.join(projectA, "1_a.jsonl"), "");

    expect(listPiAgentSessionFiles(sessionsDir)).toEqual([
      path.join(projectA, "1_a.jsonl"),
      path.join(projectB, "2_b.jsonl"),
    ]);
  });
});
