// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The `xdg-open` the CLI finds first on the demo PATH (D31). It hands the URL to the driver's control port, which
// opens it in the Playwright Chromium, so the CLI's real open path runs and the privacy probe can read the page.
export function xdgOpenScript(controlPort: number): string {
  if (!Number.isInteger(controlPort) || controlPort < 1 || controlPort > 65535) throw new RangeError(`Invalid control port: ${controlPort}`);
  return `#!/bin/sh
exec curl -fsS --max-time 20 --get --data-urlencode "url=$1" http://127.0.0.1:${controlPort}/open >/dev/null
`;
}

export function demoPath(binDir: string, basePath: string): string {
  return `${binDir}:${basePath}`;
}
