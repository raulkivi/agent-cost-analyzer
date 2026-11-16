// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from "vitest";
import { knownAnswer, notSetAnswer } from "../test-support/allowance-fixture.js";
import { ApiRequestError } from "./api-request-error.js";
import { resetApiTransport, setApiTransport } from "./current-transport.js";
import { AllowanceSettingsRejected, AllowanceUnavailable, getMonthlyAllowance, setMonthlyAllowance } from "./monthly-allowance.js";

const SETTINGS = { aiCredits: 5, resetDay: 1, warnAtPercent: 80 };

function transportAnswering(outcome: { value: unknown } | { status: number; message?: string }) {
  const call = vi.fn().mockImplementation(() => ("value" in outcome ? Promise.resolve(outcome.value) : Promise.reject(new ApiRequestError("/api/x", outcome.status, outcome.message))));
  setApiTransport({ call } as never);
  return call;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

afterEach(() => resetApiTransport());

describe("getMonthlyAllowance", () => {
  it("calls getMonthlyAllowance with the signal and returns the answer parsed", async () => {
    const answer = knownAnswer();
    const call = transportAnswering({ value: answer });
    const signal = new AbortController().signal;

    await expect(getMonthlyAllowance(signal)).resolves.toEqual(answer);

    expect(call).toHaveBeenCalledWith("getMonthlyAllowance", undefined, signal);
  });

  it("rejects an answer that breaks the domain schema (unknown with a sum)", async () => {
    transportAnswering({ value: { ...knownAnswer(), state: "unknown" } });

    await expect(getMonthlyAllowance()).rejects.toThrow();
  });

  it("rejects an answer that is not an answer", async () => {
    transportAnswering({ value: { used: 0 } });

    await expect(getMonthlyAllowance()).rejects.toThrow();
  });

  it("turns a 404 (the extension has no allowance store) into AllowanceUnavailable", async () => {
    transportAnswering({ status: 404, message: "not here" });

    await expect(getMonthlyAllowance()).rejects.toBeInstanceOf(AllowanceUnavailable);
  });

  it("lets another failure through with its status and message", async () => {
    transportAnswering({ status: 500, message: "boom" });

    await expect(getMonthlyAllowance()).rejects.toThrow(/status 500: boom/);
  });
});

describe("setMonthlyAllowance", () => {
  it("sends the settings and returns the fresh answer", async () => {
    const answer = notSetAnswer();
    const call = transportAnswering({ value: answer });
    const signal = new AbortController().signal;
    const settings = { aiCredits: null, resetDay: 1, warnAtPercent: 80 };

    await expect(setMonthlyAllowance(settings, signal)).resolves.toEqual(answer);

    expect(call).toHaveBeenCalledWith("setMonthlyAllowance", { settings }, signal);
  });

  it("turns a 400 into per-field errors for the settings dialog", async () => {
    transportAnswering({ status: 400, message: "resetDay: Too big: expected number to be <=28; warnAtPercent: Too big: expected number to be <=100" });

    const error = await rejection(setMonthlyAllowance({ ...SETTINGS, resetDay: 29, warnAtPercent: 101 }));

    expect(error).toBeInstanceOf(AllowanceSettingsRejected);
    expect((error as AllowanceSettingsRejected).fieldErrors).toEqual({
      resetDay: "Too big: expected number to be <=28",
      warnAtPercent: "Too big: expected number to be <=100",
    });
    expect((error as AllowanceSettingsRejected).otherErrors).toEqual([]);
  });

  it("keeps a message that names no field, or an unknown one, as an other error", async () => {
    transportAnswering({ status: 400, message: 'body: Invalid input; Unrecognized key: "x"; aiCredits: Too small' });

    const error = (await rejection(setMonthlyAllowance({ ...SETTINGS, aiCredits: 0 }))) as AllowanceSettingsRejected;

    expect(error.fieldErrors).toEqual({ aiCredits: "Too small" });
    expect(error.otherErrors).toEqual(["Invalid input", 'Unrecognized key: "x"']);
  });

  it("gives a 400 with no message an other error, so the dialog still says something", async () => {
    transportAnswering({ status: 400 });

    const error = (await rejection(setMonthlyAllowance(SETTINGS))) as AllowanceSettingsRejected;

    expect(error.fieldErrors).toEqual({});
    expect(error.otherErrors).toHaveLength(1);
  });

  it("turns a 404 into AllowanceUnavailable", async () => {
    transportAnswering({ status: 404 });

    await expect(setMonthlyAllowance(SETTINGS)).rejects.toBeInstanceOf(AllowanceUnavailable);
  });

  it("rejects an answer that is not an answer", async () => {
    transportAnswering({ value: { ok: true } });

    await expect(setMonthlyAllowance(SETTINGS)).rejects.toThrow();
  });
});
