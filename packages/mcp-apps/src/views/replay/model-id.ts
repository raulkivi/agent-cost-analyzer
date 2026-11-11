// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// A model id the view may send back to replay_session: a plain id, as a vendor
// profile spells it ("claude-haiku-5.5", "gpt-6.1-sol", "ollama/llama3:8b"),
// at most 100 characters (the tool's own limit). Anything else, markup or an
// instruction among it, is shown as text and never sent (plan §6).
export function isPlainModelId(model: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/.test(model);
}
