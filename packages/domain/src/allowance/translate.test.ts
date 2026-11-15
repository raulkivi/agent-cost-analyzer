// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { formatMessage, identityTranslate } from "./translate.js";

describe("formatMessage", () => {
  it("fills placeholders in one pass and leaves a missing argument as written", () => {
    expect(formatMessage("{0} and {1} and {2}", ["{1}", 2])).toBe("{1} and 2 and {2}");
  });

  it("identityTranslate is English as written", () => {
    expect(identityTranslate("{0} days left", 3)).toBe("3 days left");
  });
});
