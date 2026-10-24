import { describe, expect, it } from "vitest";
import { createNonce } from "./nonce.js";

describe("createNonce", () => {
  it("returns 128 bits of base64 per call, fresh each time", () => {
    const nonces = new Set(Array.from({ length: 50 }, () => createNonce()));

    expect(nonces.size).toBe(50);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    }
  });
});
