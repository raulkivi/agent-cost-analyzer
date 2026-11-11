// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { auditRollup, sessionAudit } from "../../view-models/audit-fixtures.js";
import { parseAuditResult } from "./parse-audit.js";

describe("parseAuditResult", () => {
  it("accepts a get_session_audit result as a session audit", () => {
    const audit = sessionAudit();
    expect(parseAuditResult(audit)).toEqual({ kind: "session", audit });
  });

  it("accepts a session audit without `calls`, which the tool leaves out unless asked", () => {
    const audit: Partial<ReturnType<typeof sessionAudit>> = { ...sessionAudit() };
    delete audit.calls;
    expect(parseAuditResult(audit)).toEqual({ kind: "session", audit });
  });

  it("accepts a get_audit_rollup result as a rollup", () => {
    const rollup = auditRollup();
    expect(parseAuditResult(rollup)).toEqual({ kind: "rollup", rollup });
  });

  it.each([undefined, null, "text", 3, {}, { totals: {} }, { ...sessionAudit(), byTool: undefined }, { ...sessionAudit(), failureRecoveryCost: null }, { ...auditRollup(), daily: undefined }, { ...auditRollup(), totals: null }, { ...auditRollup(), outcomeCoverage: undefined }])("rejects %j", (value) => {
    expect(parseAuditResult(value)).toBeUndefined();
  });
});
