// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// U11 names a model as the log spells it ("claude-sonnet-5-5-20261001");
// get_price_changes names a documented change by the price book's id
// ("claude-sonnet-5.5"). Spelling only is reconciled, the way the server's
// price-model mapper does (a "provider/" prefix, a "[1m]" tag, spaces, a
// trailing date, a hyphenated version); a near match is never guessed.
// String operations, not regexes: model ids come from log files.

const allDigits = (text: string): boolean => text.length > 0 && [...text].every((char) => char >= "0" && char <= "9");

function modelKey(modelId: string): string {
  let id = modelId.trim().toLowerCase();
  if (id.includes(" ")) id = id.split(" ").filter((part) => part.length > 0).join("-");
  if (id.includes("/")) id = id.slice(id.lastIndexOf("/") + 1);
  if (id.endsWith("]") && id.lastIndexOf("[") > 0) id = id.slice(0, id.lastIndexOf("["));
  const parts = id.split("-");
  if (parts.length > 1 && parts.at(-1)!.length === 8 && allDigits(parts.at(-1)!)) parts.pop();
  // A version spelled "5-5" or "5.5" is one version.
  return parts.join("-").split(".").join("-");
}

export function sameModel(a: string, b: string): boolean {
  const keyA = modelKey(a);
  return keyA !== "" && keyA === modelKey(b);
}
