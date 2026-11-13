// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetApiTransport, setApiTransport } from "./current-transport.js";
import { fetchSavingsReport } from "./savings.js";
import { makeSavingsReport } from "../test-support/savings-fixture.js";

afterEach(() => resetApiTransport());

describe("fetchSavingsReport", () => {
  it("calls getSavingsReport with the query and the signal, and returns the parsed report", async () => {
    const call = vi.fn().mockResolvedValue(makeSavingsReport());
    setApiTransport({ call } as never);
    const signal = new AbortController().signal;

    const report = await fetchSavingsReport({ since: "2026-10-15", includeSimulated: false }, signal);

    expect(call).toHaveBeenCalledWith("getSavingsReport", { since: "2026-10-15", includeSimulated: false }, signal);
    expect(report.opportunities).toHaveLength(5);
  });

  it("rejects an answer that is not a savings report", async () => {
    setApiTransport({ call: vi.fn().mockResolvedValue({ opportunities: "nope" }) } as never);

    await expect(fetchSavingsReport({})).rejects.toThrow();
  });

  it("lets the transport's error through (400 bad query, 404 not in this product)", async () => {
    setApiTransport({ call: vi.fn().mockRejectedValue(new Error("Savings report is not available in this product")) } as never);

    await expect(fetchSavingsReport({})).rejects.toThrow("not available");
  });
});
