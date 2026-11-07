// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// A tree row's text as SidebarViews.rowTexts reads it, against a label and
// description. VS Code draws the two in separate elements, so the row's
// innerText may have no space between them; whitespace is ignored.
const withoutWhitespace = (text: string): string => text.replace(/\s+/g, "");

export function isTreeRow(rowText: string, label: string, description: string): boolean {
  return withoutWhitespace(rowText) === withoutWhitespace(label + description);
}
