#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Unbundled shim: Node version gate, warning filter, then the bundled CLI.
// Plain ES2017 so it parses on any Node that can load an ES module.
/* global process */
import { createWarningFilter, isSupportedNode, unsupportedNodeMessage } from "./node-gate.js";

if (!isSupportedNode(process.versions.node)) {
  process.stderr.write(unsupportedNodeMessage(process.versions.node) + "\n");
  process.exit(1);
} else {
  process.emitWarning = createWarningFilter(process.emitWarning);
  import("../dist/cli.js").catch(function (error) {
    if (error && error.code === "ERR_MODULE_NOT_FOUND" && /dist[\\/]cli\.js/.test(String(error.message))) {
      process.stderr.write("agent-cost-analyzer: dist/cli.js is missing; this package is not built.\n");
    } else {
      process.stderr.write(String((error && error.stack) || error) + "\n");
    }
    process.exit(1);
  });
}
