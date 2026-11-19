// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// Decorative: every use sits beside text or carries an aria-label on its button.
const common = {
  width: 14,
  height: 14,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  "aria-hidden": true,
  focusable: false,
} as const;

export function PlugIcon() {
  return (
    <svg {...common} className="mcp-icon">
      <path d="M5.5 1.5v3M10.5 1.5v3M3.5 4.5h9v2.5a4.5 4.5 0 0 1-9 0zM8 11.5v3" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg {...common} className="mcp-icon">
      <rect x="5.5" y="5.5" width="8" height="9" />
      <path d="M10.5 3.5v-2h-8v9h2" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg {...common} className="mcp-icon">
      <path d="m3 8.5 3.2 3.2L13 4.8" />
    </svg>
  );
}
