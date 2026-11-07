// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { turnSimulationSchema } from "./simulation.js";

const simulation = {
  vendorId: "anthropic",
  modelId: "claude-sonnet-5-5",
  cacheOutcome: "miss",
  invalidatedFrom: "system",
  note: "image invalidated the conversation cache",
  confidence: "documented",
  sourceIds: ["anthropic-caching"],
};

function without<T extends object>(obj: T, key: keyof T): Partial<T> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

describe("turnSimulationSchema", () => {
  it("accepts a full simulation", () => {
    expect(turnSimulationSchema.parse(simulation)).toEqual(simulation);
  });

  it("accepts a simulation without invalidatedFrom", () => {
    const sample = without(simulation, "invalidatedFrom");

    expect(turnSimulationSchema.parse(sample)).toEqual(sample);
  });

  it("accepts each documented cacheOutcome", () => {
    for (const cacheOutcome of ["hit", "partial", "miss", "unknown"]) {
      expect(
        turnSimulationSchema.safeParse({ ...simulation, cacheOutcome }).success,
      ).toBe(true);
    }
  });

  it("rejects an unknown cacheOutcome", () => {
    expect(
      turnSimulationSchema.safeParse({ ...simulation, cacheOutcome: "stale" })
        .success,
    ).toBe(false);
  });

  it("rejects an invalidatedFrom that is not a layer", () => {
    expect(
      turnSimulationSchema.safeParse({
        ...simulation,
        invalidatedFrom: "nothing",
      }).success,
    ).toBe(false);
  });

  it("requires vendorId, modelId, note and sourceIds", () => {
    for (const key of ["vendorId", "modelId", "note", "sourceIds"] as const) {
      expect(
        turnSimulationSchema.safeParse(without(simulation, key)).success,
      ).toBe(false);
    }
  });

  it("rejects a documented simulation without sourceIds", () => {
    const result = turnSimulationSchema.safeParse({
      ...simulation,
      sourceIds: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["sourceIds"]);
      expect(result.error.issues[0]?.message).toBe(
        "documented needs sourceIds; unknown must not carry them",
      );
    }
  });

  it("rejects an unknown simulation that carries sourceIds", () => {
    const result = turnSimulationSchema.safeParse({
      ...simulation,
      cacheOutcome: "unknown",
      confidence: "unknown",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["sourceIds"]);
    }
  });

  it("accepts an unknown simulation without sourceIds", () => {
    const sample = {
      ...simulation,
      cacheOutcome: "unknown",
      confidence: "unknown",
      sourceIds: [],
    };

    expect(turnSimulationSchema.parse(sample)).toEqual(sample);
  });

  it("accepts an inferred simulation with or without sourceIds", () => {
    const inferred = { ...simulation, confidence: "inferred" };

    expect(turnSimulationSchema.safeParse(inferred).success).toBe(true);
    expect(
      turnSimulationSchema.safeParse({ ...inferred, sourceIds: [] }).success,
    ).toBe(true);
  });
});
