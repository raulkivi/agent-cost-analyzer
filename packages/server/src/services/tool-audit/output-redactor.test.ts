import { describe, expect, it } from "vitest";
import { excerptOf, redactSecrets } from "./output-redactor.js";

describe("redactSecrets", () => {
  it.each([
    ["token ghp_abcdefghijklmnopqrstuvwxyz0123456789 leaked", "abcdefghijklmnop"],
    ["key sk-ant-api03-abcdefghijklmnopqrstuv", "abcdefghijklmnop"],
    ["OPENAI sk-proj-abcdefghijklmnopqrstuv", "abcdefghijklmnop"],
    ["aws AKIAABCDEFGHIJKLMNOP", "ABCDEFGHIJKLMNOP"],
    ["Authorization: Bearer abc.def.ghi-jkl_123456", "abc.def"],
    ["password=hunter2hunter2", "hunter2"],
    ["jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl", "eyJzdWIiOiIxIn0"],
  ])("masks the secret in %j", (input, secret) => {
    const redacted = redactSecrets(input);
    expect(redacted).toContain("[REDACTED]");
    expect(redacted).not.toContain(secret);
  });

  // Built at run time so the file holds no string a secret scanner flags.
  const body = (length: number) => "Ab1".repeat(Math.ceil(length / 3)).slice(0, length);
  it.each([
    ["Google API key", `key=${"AI" + "za"}${body(35)}&q=1`],
    ["Stripe secret key", `stripe ${"sk_" + "live_"}${body(24)}`],
    ["Stripe restricted key", `${"rk_" + "test_"}${body(24)} in env`],
    ["npm token", `//registry.npmjs.org/:_authToken ${"npm_"}${body(36)}`],
    ["GitLab token", `GITLAB ${"glpat-"}${body(20)}`],
    ["Hugging Face token", `HF ${"hf_"}${body(34)}`],
  ])("masks a %s, which leaves the machine in MCP tool results", (_name, input) => {
    const redacted = redactSecrets(input);
    expect(redacted).toContain("[REDACTED]");
    expect(redacted).not.toContain(body(16));
  });

  it("leaves ordinary error text alone", () => {
    const text = "/bin/bash: line 1: foo: command not found";
    expect(redactSecrets(text)).toBe(text);
  });
});

describe("excerptOf", () => {
  it("truncates to the limit with an ellipsis", () => {
    const excerpt = excerptOf("x".repeat(500), 200);
    expect(excerpt.length).toBe(200);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("redacts before truncating", () => {
    expect(excerptOf("ghp_abcdefghijklmnopqrstuvwxyz0123456789", 200)).toBe("[REDACTED]");
  });
});
