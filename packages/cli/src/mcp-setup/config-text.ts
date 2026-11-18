// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ClientSetup } from "../../../server/src/mcp/client-setup/client-setup.js";
import { shellLine } from "./shell-quote.js";

// The whole file shape, e.g. {"mcpServers":{"<name>":{…}}}, so the user can
// paste it into an empty file.
function jsonSnippet(json: NonNullable<ClientSetup["json"]>): string {
  const inner = { [json.name]: json.entry };
  const shape = [...json.keyPath]
    .reverse()
    .reduce<unknown>((value, key) => ({ [key]: value }), inner);
  return JSON.stringify(shape, null, 2);
}

/** Everything a user needs to register by hand; one section per form. */
export function configText(setup: ClientSetup): string {
  const sections: string[] = [];
  if (setup.command) sections.push(`Command:\n  ${shellLine(setup.command)}`);
  if (setup.json) sections.push(`JSON:\n${indent(jsonSnippet(setup.json))}`);
  if (setup.toml) sections.push(`TOML:\n${indent(setup.toml.trimEnd())}`);
  if (setup.installLink) sections.push(`Install link:\n  ${setup.installLink}`);
  return sections.join("\n\n");
}

const indent = (text: string) =>
  text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
