// What the opt-in real-Copilot suite copies from the owner's throwaway,
// signed-in VS Code user-data dir, and nothing else: `User` (settings, global
// state with the model choice and extension enablement, Copilot's stores) and
// `Local State`. The copy is what VS Code runs on and is deleted afterwards;
// the source is only read. The suite never opens, parses or prints secrets:
// VS Code finds its own sign-in in the copied state.
import { cpSync, existsSync } from "node:fs";
import path from "node:path";

export const COPIED_ENTRIES = ["User", "Local State"];

export function copyProfile(source: string, target: string): void {
  const relative = path.relative(path.resolve(source), path.resolve(target));
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error(`The profile copy (${target}) must not be inside the profile (${source})`);
  }
  for (const entry of COPIED_ENTRIES) {
    const from = path.join(source, entry);
    if (existsSync(from)) cpSync(from, path.join(target, entry), { recursive: true });
  }
}
