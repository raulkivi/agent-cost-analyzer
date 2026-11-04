// Packages the built extension (dist/, media/: run `npm run build` first) as a
// VSIX for check 1.12, exactly as `npm run package` does, into `outFile`.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const packageDir = path.resolve(import.meta.dirname, "../..");

let built: string | undefined;

export function buildVsix(outFile: string): string {
  if (built !== undefined && existsSync(built)) return built;
  if (!existsSync(path.join(packageDir, "dist", "extension.js"))) {
    throw new Error("dist/extension.js is missing: run `npm run build` before the UI suite");
  }
  execFileSync(path.join(packageDir, "../../node_modules/.bin/vsce"), ["package", "--no-dependencies", "--out", outFile], { cwd: packageDir, stdio: "pipe" });
  built = outFile;
  return outFile;
}
