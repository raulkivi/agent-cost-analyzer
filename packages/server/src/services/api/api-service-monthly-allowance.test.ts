// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { AllowanceSettingsWrite, MonthlyAllowanceAnswer } from "@agent-cost-analyzer/domain";
import { ApiService, MONTHLY_ALLOWANCE_UNAVAILABLE_MESSAGE, type ApiServiceDeps } from "./api-service.js";
import { BadRequestError, NotFoundError } from "./api-errors.js";

// MS13: setMonthlyAllowance is the one gate for the HTTP PUT and the webview
// RPC (both pass an unvalidated body). Whatever arrives, the store is written
// only for a valid object.
const ANSWER = { state: "not-set" } as unknown as MonthlyAllowanceAnswer;
const VALID = { aiCredits: 1000, resetDay: 5, warnAtPercent: 90 };

function service() {
  const saved: AllowanceSettingsWrite[] = [];
  const api = new ApiService({ monthlyAllowance: { get: async () => ANSWER, save: async (settings: AllowanceSettingsWrite) => (saved.push(settings), ANSWER) } } as unknown as ApiServiceDeps);
  return { api, saved };
}

describe("ApiService.setMonthlyAllowance", () => {
  it("saves a valid object, and null to remove", async () => {
    const { api, saved } = service();
    await api.setMonthlyAllowance(VALID);
    await api.setMonthlyAllowance({ ...VALID, aiCredits: null });
    await api.setMonthlyAllowance({ ...VALID, aiCredits: 1_000_000_000, resetDay: 28, warnAtPercent: 1 });
    expect(saved).toHaveLength(3);
  });

  const hostile: [string, unknown][] = [
    ["undefined (no body)", undefined],
    ["null", null],
    ["a string", "aiCredits=5"],
    ["an array", [VALID]],
    ["a number", 5],
    ["zero", { ...VALID, aiCredits: 0 }],
    ["negative", { ...VALID, aiCredits: -0.01 }],
    ["Infinity", { ...VALID, aiCredits: Number.POSITIVE_INFINITY }],
    ["NaN", { ...VALID, aiCredits: Number.NaN }],
    ["a numeric string", { ...VALID, aiCredits: "1000" }],
    ["above the sanity cap", { ...VALID, aiCredits: 1_000_000_001 }],
    ["reset day 0", { ...VALID, resetDay: 0 }],
    ["reset day 29", { ...VALID, resetDay: 29 }],
    ["reset day 31", { ...VALID, resetDay: 31 }],
    ["a fractional reset day", { ...VALID, resetDay: 1.5 }],
    ["warn 0", { ...VALID, warnAtPercent: 0 }],
    ["warn 101", { ...VALID, warnAtPercent: 101 }],
    ["a boolean field", { ...VALID, warnAtPercent: true }],
    ["a missing field", { aiCredits: 5 }],
    ["an unknown key", { ...VALID, extra: 1 }],
    ["an own __proto__ key", JSON.parse('{"aiCredits":5,"resetDay":1,"warnAtPercent":80,"__proto__":{"admin":true}}')],
    ["a nested object value", { ...VALID, aiCredits: { value: 5 } }],
    ["a script in a field", { ...VALID, resetDay: "<script>alert(1)</script>" }],
  ];

  it.each(hostile)("rejects %s and saves nothing", async (_name, body) => {
    const { api, saved } = service();
    await expect(api.setMonthlyAllowance(body)).rejects.toBeInstanceOf(BadRequestError);
    expect(saved).toEqual([]);
  });

  it("does not echo a hostile value back in the message", async () => {
    const { api } = service();
    const error = await api.setMonthlyAllowance({ ...VALID, resetDay: "<script>alert(1)</script>" }).then(
      () => new Error("accepted"),
      (rejected: Error) => rejected,
    );
    expect(error).toBeInstanceOf(BadRequestError);
    expect(error.message).toMatch(/resetDay/);
    expect(error.message).not.toMatch(/script/);
  });

  it("is not found in a product without the store (the extension)", async () => {
    const api = new ApiService({} as ApiServiceDeps);
    await expect(api.setMonthlyAllowance(VALID)).rejects.toEqual(new NotFoundError(MONTHLY_ALLOWANCE_UNAVAILABLE_MESSAGE));
  });
});
