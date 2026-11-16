// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { MAX_ARGS_SUMMARY_LENGTH } from "../../services/tool-audit/args-summary.js";
import { AUDIT_ATTRS_KEYS, MAX_AUDIT_ERROR_LENGTH, projectAuditAttrs } from "./audit-attrs-projector.js";

describe("projectAuditAttrs", () => {
  it("keeps only args and error", () => {
    expect([...AUDIT_ATTRS_KEYS].sort()).toEqual(["args", "error"]);
  });

  it("never keeps result, content or other wide keys", () => {
    const projected = projectAuditAttrs({ args: "{}", result: "secret output", content: "prompt", inputMessages: "[]" });
    expect(projected).toEqual({ args: "{}" });
  });

  it("cuts a 50 KB args string to the summary bound", () => {
    const projected = projectAuditAttrs({ args: "x".repeat(50_000) });
    expect((projected?.args as string).length).toBe(MAX_ARGS_SUMMARY_LENGTH);
  });

  it("cuts error text to 2 KB", () => {
    const projected = projectAuditAttrs({ error: "e".repeat(10_000) });
    expect((projected?.error as string).length).toBe(MAX_AUDIT_ERROR_LENGTH);
    expect(MAX_AUDIT_ERROR_LENGTH).toBe(2048);
  });

  it("drops a non-string args or error value", () => {
    expect(projectAuditAttrs({ args: { a: 1 }, error: 5 })).toBeUndefined();
  });

  it("returns undefined for non-objects and for attrs with no audit key", () => {
    expect(projectAuditAttrs(undefined)).toBeUndefined();
    expect(projectAuditAttrs("text")).toBeUndefined();
    expect(projectAuditAttrs({ result: "x" })).toBeUndefined();
  });
});
