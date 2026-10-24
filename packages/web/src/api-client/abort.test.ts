import { describe, expect, it } from "vitest";
import { abortError, isAbortError } from "./abort.js";

describe("abort errors", () => {
  it("abortError is an AbortError", () => {
    expect(abortError()).toMatchObject({ name: "AbortError" });
    expect(isAbortError(abortError())).toBe(true);
  });

  it("recognises the AbortError a fetch rejects with, and nothing else", () => {
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isAbortError(Object.assign(new Error("x"), { name: "AbortError" }))).toBe(true);
    expect(isAbortError(new Error("Request failed with status 500"))).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});
