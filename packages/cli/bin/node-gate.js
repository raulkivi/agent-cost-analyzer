// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Helpers of the bin shim. Ships unbundled and runs before anything else, so
// it stays ES2017, dependency-free and free of node: imports.

var MIN = [22, 18, 0];

export function isSupportedNode(version) {
  var match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version));
  if (!match) return false;
  for (var i = 0; i < 3; i++) {
    var have = Number(match[i + 1]);
    if (have !== MIN[i]) return have > MIN[i];
  }
  return true;
}

export function unsupportedNodeMessage(version) {
  return "Agent Cost Analyzer needs Node.js 22.18 or newer; this is " + version;
}

function warningType(warning, rest) {
  var second = rest[0];
  if (typeof second === "string") return second;
  if (second && typeof second === "object" && typeof second.type === "string") return second.type;
  return warning && typeof warning === "object" ? warning.name : "Warning";
}

function isSqliteExperimentalWarning(warning, rest) {
  var text = typeof warning === "string" ? warning : warning && warning.message;
  return warningType(warning, rest) === "ExperimentalWarning" && typeof text === "string" && /SQLite/.test(text);
}

// Wraps process.emitWarning: only the node:sqlite ExperimentalWarning is
// dropped; every other warning still reaches the original.
export function createWarningFilter(original) {
  return function filteredEmitWarning(warning, ...rest) {
    if (isSqliteExperimentalWarning(warning, rest)) return undefined;
    return original.call(this, warning, ...rest);
  };
}
