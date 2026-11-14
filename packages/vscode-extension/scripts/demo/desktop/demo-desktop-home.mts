// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createFixtureHome, type FixtureHome } from "../../../../web/e2e/support/fixture-home.mts";

// D21: Claude's answer must not say "fixture". The shared e2e fixture names its Copilot test models
// "fixture-*"; the Desktop takes rename them to ids the github-copilot price book prices, so the vendor
// resolves and the answer reads like real use. The shared fixture and its snapshots stay as they are.
export const DEMO_COPILOT_MODELS = {
  "fixture-main-model": "claude-sonnet-5.5",
  "fixture-sub-model": "claude-haiku-5.5",
  "fixture-search-model": "gemini-3.8-flash",
} as const;

function textFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return textFiles(file);
    return file.endsWith(".jsonl") || file.endsWith(".json") ? [file] : [];
  });
}

export function createDemoDesktopHome(home: string): FixtureHome {
  const fixture = createFixtureHome(home);
  for (const file of textFiles(home)) {
    let text = readFileSync(file, "utf8");
    const original = text;
    for (const [from, to] of Object.entries(DEMO_COPILOT_MODELS)) text = text.replaceAll(from, to);
    if (text !== original) writeFileSync(file, text);
  }
  return fixture;
}
