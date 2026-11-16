// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from "vitest";
import { knownAnswer, notSetAnswer } from "../test-support/allowance-fixture.js";
import { AllowanceSettingsRejected, AllowanceUnavailable, getMonthlyAllowance, setMonthlyAllowance } from "./monthly-allowance.js";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const SETTINGS = { aiCredits: 5, resetDay: 1, warnAtPercent: 80 };

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("getMonthlyAllowance", () => {
  it("GETs the answer and returns it parsed", async () => {
    const answer = knownAnswer();
    const fetchMock = stubFetch(json(200, answer));
    const signal = new AbortController().signal;

    await expect(getMonthlyAllowance(signal)).resolves.toEqual(answer);

    expect(fetchMock).toHaveBeenCalledWith("/api/monthly-allowance", { signal });
  });

  it("rejects an answer that breaks the domain schema (unknown with a sum)", async () => {
    stubFetch(json(200, { ...knownAnswer(), state: "unknown" }));

    await expect(getMonthlyAllowance()).rejects.toThrow();
  });

  it("rejects an answer that is not an answer", async () => {
    stubFetch(json(200, { used: 0 }));

    await expect(getMonthlyAllowance()).rejects.toThrow();
  });

  it("turns a 404 (the extension has no allowance store) into AllowanceUnavailable", async () => {
    stubFetch(json(404, { error: "The monthly allowance is not available in this product." }));

    await expect(getMonthlyAllowance()).rejects.toBeInstanceOf(AllowanceUnavailable);
  });

  it("lets another failure through with its status and message", async () => {
    stubFetch(json(500, { error: "boom" }));

    await expect(getMonthlyAllowance()).rejects.toThrow(/status 500: boom/);
  });
});

describe("setMonthlyAllowance", () => {
  it("PUTs the settings as JSON and returns the fresh answer", async () => {
    const answer = notSetAnswer();
    const fetchMock = stubFetch(json(200, answer));
    const settings = { aiCredits: null, resetDay: 1, warnAtPercent: 80 };

    await expect(setMonthlyAllowance(settings)).resolves.toEqual(answer);

    expect(fetchMock).toHaveBeenCalledWith("/api/config/monthly-allowance", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
  });

  it("hands on the signal", async () => {
    const fetchMock = stubFetch(json(200, notSetAnswer()));
    const signal = new AbortController().signal;

    await setMonthlyAllowance(SETTINGS, signal);

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ signal });
  });

  it("turns a 400 into per-field errors for the settings dialog", async () => {
    stubFetch(json(400, { error: "resetDay: Too big: expected number to be <=28; warnAtPercent: Too big: expected number to be <=100" }));

    const error = await rejection(setMonthlyAllowance({ ...SETTINGS, resetDay: 29, warnAtPercent: 101 }));

    expect(error).toBeInstanceOf(AllowanceSettingsRejected);
    expect((error as AllowanceSettingsRejected).fieldErrors).toEqual({
      resetDay: "Too big: expected number to be <=28",
      warnAtPercent: "Too big: expected number to be <=100",
    });
    expect((error as AllowanceSettingsRejected).otherErrors).toEqual([]);
  });

  it("keeps a message that names no field, or an unknown one, as an other error", async () => {
    stubFetch(json(400, { error: 'body: Invalid input; Unrecognized key: "x"; aiCredits: Too small' }));

    const error = (await rejection(setMonthlyAllowance({ ...SETTINGS, aiCredits: 0 }))) as AllowanceSettingsRejected;

    expect(error.fieldErrors).toEqual({ aiCredits: "Too small" });
    expect(error.otherErrors).toEqual(["Invalid input", 'Unrecognized key: "x"']);
  });

  it("gives a 400 with no body an other error, so the dialog still says something", async () => {
    stubFetch(new Response("", { status: 400 }));

    const error = (await rejection(setMonthlyAllowance(SETTINGS))) as AllowanceSettingsRejected;

    expect(error.fieldErrors).toEqual({});
    expect(error.otherErrors).toHaveLength(1);
  });

  it("turns a 404 into AllowanceUnavailable", async () => {
    stubFetch(json(404, { error: "no" }));

    await expect(setMonthlyAllowance(SETTINGS)).rejects.toBeInstanceOf(AllowanceUnavailable);
  });

  it("rejects a 200 whose body is not an answer", async () => {
    stubFetch(json(200, { ok: true }));

    await expect(setMonthlyAllowance(SETTINGS)).rejects.toThrow();
  });
});
