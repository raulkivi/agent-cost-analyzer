import { mkdirSync } from "node:fs";
import path from "node:path";
import { browser } from "@wdio/globals";

// Failure and per-theme screenshots land here; CI uploads the folder.
export const OUT_DIR = path.resolve(import.meta.dirname, "../out");

export async function saveScreenshot(name: string): Promise<string> {
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}.png`);
  await browser.saveScreenshot(file);
  return file;
}
