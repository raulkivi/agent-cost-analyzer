// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { failureCategorySchema, isFailedStatus, toolCallOutcomeSchema, toolCallStatusSchema } from "./tool-call-outcome.js";

describe("toolCallStatusSchema", () => {
  it("accepts every audit status", () => {
    for (const status of ["success", "error", "interrupted", "denied", "unknown", "canceled"]) {
      expect(toolCallStatusSchema.parse(status)).toBe(status);
    }
  });
});

describe("failureCategorySchema", () => {
  it("includes the categories the user asked for", () => {
    for (const category of [
      "command-not-found",
      "wrong-directory",
      "invalid-arguments",
      "dependency-missing",
      "git-state",
      "blocked-by-policy",
      "already-exists",
      "unclassified",
    ]) {
      expect(failureCategorySchema.parse(category)).toBe(category);
    }
  });
});

describe("toolCallOutcomeSchema", () => {
  it("accepts a success with no category", () => {
    expect(toolCallOutcomeSchema.parse({ status: "success" })).toEqual({ status: "success" });
  });

  it("accepts a classified failure with exit code and evidence", () => {
    const outcome = {
      status: "error",
      exitCode: 127,
      failureCategory: "command-not-found",
      classificationEvidence: { ruleId: "shell.exit-127", excerpt: "foo: command not found" },
    };
    expect(toolCallOutcomeSchema.parse(outcome)).toEqual(outcome);
  });

  it("rejects status unknown without a reason (constraint 6: never a silent unknown)", () => {
    expect(() => toolCallOutcomeSchema.parse({ status: "unknown" })).toThrow();
    expect(toolCallOutcomeSchema.parse({ status: "unknown", reason: "source has no outcome" }).status).toBe("unknown");
  });

  it("rejects a failure category on a successful call", () => {
    expect(() => toolCallOutcomeSchema.parse({ status: "success", failureCategory: "timeout" })).toThrow();
  });

  it("accepts a canceled call with no failure category (D14: a user stop is not a failure)", () => {
    expect(toolCallOutcomeSchema.parse({ status: "canceled", reason: "Canceled" })).toEqual({
      status: "canceled",
      reason: "Canceled",
    });
    expect(() => toolCallOutcomeSchema.parse({ status: "canceled", failureCategory: "other-nonzero-exit" })).toThrow();
  });

  it("does not count canceled as a failed status", () => {
    expect(isFailedStatus("canceled")).toBe(false);
  });

  it("accepts the already-exists category on an error (D13)", () => {
    const outcome = { status: "error", failureCategory: "already-exists" };
    expect(toolCallOutcomeSchema.parse(outcome)).toEqual(outcome);
  });

  it("rejects an excerpt longer than 200 characters", () => {
    expect(() =>
      toolCallOutcomeSchema.parse({
        status: "error",
        failureCategory: "unclassified",
        classificationEvidence: { ruleId: "x", excerpt: "a".repeat(201) },
      }),
    ).toThrow();
  });
});
