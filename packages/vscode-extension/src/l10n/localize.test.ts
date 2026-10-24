import { describe, expect, it } from "vitest";
import { formatMessage, identityTranslate } from "./localize.js";

describe("formatMessage (the {0} placeholders vscode.l10n.t uses)", () => {
  it("returns a message without placeholders as it is", () => {
    expect(formatMessage("Refresh", [])).toBe("Refresh");
  });

  it("replaces each {n} with the argument at that index, text or number", () => {
    expect(formatMessage("{0} of {1} sessions", [3, "5"])).toBe("3 of 5 sessions");
  });

  it("allows a placeholder to repeat and to come in any order", () => {
    expect(formatMessage("{1}, {0}, {1}", ["a", "b"])).toBe("b, a, b");
  });

  it("leaves a placeholder with no argument as written", () => {
    expect(formatMessage("{0} and {1}", ["a"])).toBe("a and {1}");
  });

  it("does not re-expand placeholders inside an argument", () => {
    expect(formatMessage("{0} {1}", ["{1}", "x"])).toBe("{1} x");
  });
});

describe("identityTranslate", () => {
  it("is the English translation: the message with its arguments filled in", () => {
    expect(identityTranslate("{0} turns", 4)).toBe("4 turns");
  });
});
