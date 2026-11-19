// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useRef, type KeyboardEvent } from "react";
import { CLIENT_IDS, CLIENT_LABELS, isClientId } from "../../lib/mcp-setup/clients.js";
import type { McpSetupClientId } from "@agent-cost-analyzer/domain";

interface ClientNavProps {
  selected: McpSetupClientId;
  onSelect: (id: McpSetupClientId) => void;
  // Narrow screens swap the vertical tabs for a native select.
  asSelect: boolean;
  idBase: string;
  panelId: string;
}

export const tabId = (idBase: string, id: McpSetupClientId) => `${idBase}-tab-${id}`;

// Where a key sends the selection, or undefined for any other key.
function targetOf(key: string, index: number): number | undefined {
  const last = CLIENT_IDS.length - 1;
  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return index === last ? 0 : index + 1;
    case "ArrowUp":
    case "ArrowLeft":
      return index === 0 ? last : index - 1;
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return undefined;
  }
}

// The agent list: a vertical tablist with automatic activation (an arrow key
// moves focus and selects at once, as the owner chose), one tab stop through
// a roving tabindex. At narrow widths, a select labeled "Agent".
export function ClientNav({ selected, onSelect, asSelect, idBase, panelId }: ClientNavProps) {
  const tabs = useRef(new Map<McpSetupClientId, HTMLButtonElement>());

  if (asSelect) {
    return (
      <label className="mcp-agent-select">
        <span className="text-muted text-2xs">Agent</span>
        <select
          className="input"
          value={selected}
          onChange={(event) => {
            if (isClientId(event.target.value)) onSelect(event.target.value);
          }}
        >
          {CLIENT_IDS.map((id) => (
            <option key={id} value={id}>
              {CLIENT_LABELS[id]}
            </option>
          ))}
        </select>
      </label>
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>, index: number): void {
    const target = targetOf(event.key, index);
    if (target === undefined) return;
    event.preventDefault();
    const id = CLIENT_IDS[target];
    if (!id) return;
    onSelect(id);
    tabs.current.get(id)?.focus();
  }

  return (
    <div role="tablist" aria-label="Agent" aria-orientation="vertical" className="mcp-tabs">
      {CLIENT_IDS.map((id, index) => (
        <button
          key={id}
          ref={(element) => {
            if (element) tabs.current.set(id, element);
            else tabs.current.delete(id);
          }}
          type="button"
          role="tab"
          id={tabId(idBase, id)}
          className="mcp-tab"
          aria-selected={id === selected}
          aria-controls={panelId}
          tabIndex={id === selected ? 0 : -1}
          onClick={() => onSelect(id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {CLIENT_LABELS[id]}
        </button>
      ))}
    </div>
  );
}
