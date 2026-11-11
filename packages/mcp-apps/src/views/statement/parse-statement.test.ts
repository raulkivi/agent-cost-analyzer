// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { statementAnswer } from "../../view-models/increment3-fixtures.js";
import { parseStatementAnswer } from "./parse-statement.js";

describe("parseStatementAnswer", () => {
  it("accepts a get_statement result", () => {
    expect(parseStatementAnswer(statementAnswer())).toBeDefined();
  });

  it.each([undefined, null, "x", {}, { statement: {} }, { ...statementAnswer(), issuedPeriods: "2026-09" }, { ...statementAnswer(), statement: { ...statementAnswer().statement, status: "paid" } }])("rejects %j", (value) => {
    expect(parseStatementAnswer(value)).toBeUndefined();
  });
});
