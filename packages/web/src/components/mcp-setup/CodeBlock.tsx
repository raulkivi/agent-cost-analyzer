// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState } from "react";
import { getHostCapabilities } from "../../host/current-host-capabilities.js";
import { CheckIcon, CopyIcon } from "./icons.js";

interface CodeBlockProps {
  text: string;
  // The block's accessible name, e.g. "Install command for Cursor".
  label: string;
  // What the Copy button copies, e.g. "install command": "Copy: install command".
  copyLabel: string;
  // Injectable for tests; the host's clipboard otherwise.
  copy?: (text: string) => Promise<void>;
}

type CopyState = "idle" | "copied" | "failed";

const COPIED_MS = 2000;

// A command or JSON the person copies. Lines never wrap (white-space: pre in
// the stylesheet): the block scrolls sideways, the dialog does not. Copy is a
// button that says "Copied" for two seconds; if the clipboard refuses, the
// text is selected and the person is told to press Ctrl+C.
export function CodeBlock({ text, label, copyLabel, copy = (value) => getHostCapabilities().copyToClipboard(value) }: CodeBlockProps) {
  const pre = useRef<HTMLPreElement>(null);
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state !== "copied") return;
    const timer = setTimeout(() => setState("idle"), COPIED_MS);
    return () => clearTimeout(timer);
  }, [state]);

  function selectText(): void {
    const selection = window.getSelection();
    if (!pre.current || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(pre.current);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  async function onCopy(): Promise<void> {
    try {
      await copy(text);
      setState("copied");
    } catch {
      selectText();
      setState("failed");
    }
  }

  const copied = state === "copied";
  const visible = copied ? "Copied" : "Copy";

  return (
    <div className="mcp-code">
      <pre ref={pre} className="mcp-code-text" role="group" aria-label={label} tabIndex={0}>
        {text}
      </pre>
      <button
        type="button"
        className={`btn btn-secondary btn-sm mcp-copy${copied ? " mcp-copy--done" : ""}`}
        aria-label={`${visible}: ${copyLabel}`}
        onClick={() => void onCopy()}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {visible}
      </button>
      <span role="status" className="sr-only">
        {copied ? "Copied" : state === "failed" ? "Press Ctrl+C to copy" : ""}
      </span>
      {state === "failed" && <p className="mcp-copy-hint">Press Ctrl+C to copy</p>}
    </div>
  );
}
