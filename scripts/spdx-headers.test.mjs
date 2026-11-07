// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { addHeader, hasHeader, isHeaderTarget } from "./spdx-headers.mjs";

const TS =
  "// SPDX-FileCopyrightText: 2026 Raul Kivi\n// SPDX-License-Identifier: MIT\n";

test("adds a // header to ts files", () => {
  assert.equal(addHeader("a.ts", "const a = 1;\n"), `${TS}const a = 1;\n`);
});

test("adds a /* */ header to css files", () => {
  const out = addHeader("a.css", "body {}\n");
  assert.ok(out.startsWith("/* SPDX-FileCopyrightText: 2026 Raul Kivi\n"));
  assert.ok(out.endsWith("*/\nbody {}\n"));
});

test("keeps the shebang on the first line of shell scripts", () => {
  const out = addHeader("run.sh", "#!/usr/bin/env bash\nset -e\n");
  assert.ok(
    out.startsWith(
      "#!/usr/bin/env bash\n# SPDX-FileCopyrightText: 2026 Raul Kivi\n",
    ),
  );
});

test("is idempotent", () => {
  const once = addHeader("a.ts", "x\n");
  assert.equal(addHeader("a.ts", once), once);
  assert.ok(hasHeader(once));
});

test("detects a missing header", () => {
  assert.equal(hasHeader("const a = 1;\n"), false);
});

test("selects source files only, skipping fixtures and vendored dirs", () => {
  assert.equal(isHeaderTarget("packages/server/src/a.ts"), true);
  assert.equal(isHeaderTarget("scripts/install.sh"), true);
  assert.equal(isHeaderTarget("packages/server/fixtures/x.ts"), false);
  assert.equal(isHeaderTarget("ds-bundle/x.js"), false);
  assert.equal(isHeaderTarget("README.md"), false);
});
