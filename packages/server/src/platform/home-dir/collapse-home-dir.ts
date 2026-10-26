// Shortens a path under the home directory to `~` so help text shown in the
// UI (and in screenshots users share) doesn't reveal the OS username. Only a
// whole leading path segment collapses: `/home/al` leaves `/home/alice/x` alone.
export function collapseHomeDir(filePath: string, homeDir: string): string {
  const home = homeDir.replace(/[\\/]+$/, "");
  if (home === "") {
    return filePath;
  }
  if (filePath === home) {
    return "~";
  }
  const next = filePath.charAt(home.length);
  if (filePath.startsWith(home) && (next === "/" || next === "\\")) {
    return `~${filePath.slice(home.length)}`;
  }
  return filePath;
}
