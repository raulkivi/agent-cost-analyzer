import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { redactHeaders } from "./redact-headers.js";

const FIXED_CREDENTIAL_NAMES = ["authorization", "x-api-key", "api-key", "proxy-authorization", "cookie", "set-cookie"];

// Excludes `__proto__`-style names, which are not valid HTTP header names anyway.
const headerName = fc.stringMatching(/^[A-Za-z][A-Za-z0-9_-]{0,20}$/);
const headers = fc.dictionary(headerName, fc.string({ maxLength: 40 }), { maxKeys: 8 });

const randomCase = (word: string) =>
  fc.array(fc.boolean(), { minLength: word.length, maxLength: word.length }).map((flags) =>
    [...word].map((ch, i) => (flags[i] ? ch.toUpperCase() : ch.toLowerCase())).join(""),
  );

// Every name here matches CREDENTIAL_NAME_PATTERN via a different alternative.
const patternCredentialName = fc
  .tuple(
    fc.stringMatching(/^[a-z0-9]{0,8}$/),
    fc.constantFrom("api-key", "api_key", "apikey", "secret", "-token", "_token", "-auth-x", "_auth", "security-token"),
  )
  .chain(([prefix, core]) => randomCase(`${prefix}${core}`));

describe("redactHeaders (property-based)", () => {
  it("only ever removes headers, and keeps surviving values unchanged", () => {
    fc.assert(
      fc.property(headers, (input) => {
        const output = redactHeaders(input);
        for (const [name, value] of Object.entries(output)) {
          expect(input).toHaveProperty([name]);
          expect(value).toBe(input[name]);
        }
      }),
    );
  });

  it("drops every fixed credential header in any casing", () => {
    fc.assert(
      fc.property(
        headers,
        fc.constantFrom(...FIXED_CREDENTIAL_NAMES).chain(randomCase),
        fc.string({ maxLength: 40 }),
        (input, credential, secret) => {
          expect(redactHeaders({ ...input, [credential]: secret })).not.toHaveProperty([credential]);
        },
      ),
    );
  });

  it("drops names that look like credentials", () => {
    fc.assert(
      fc.property(headers, patternCredentialName, fc.string({ maxLength: 40 }), (input, credential, secret) => {
        expect(redactHeaders({ ...input, [credential]: secret })).not.toHaveProperty([credential]);
      }),
    );
  });

  it("keeps rate-limit token-count headers, which carry no secret", () => {
    const rateLimitName = fc
      .tuple(fc.constantFrom("limit", "remaining", "reset", "requests", "input", "output"), fc.constantFrom("", "-tokens"))
      .map(([kind, suffix]) => `x-ratelimit-${kind}${suffix}`);
    fc.assert(
      fc.property(rateLimitName.chain(randomCase), fc.string({ maxLength: 40 }), (name, value) => {
        expect(redactHeaders({ [name]: value })).toEqual({ [name]: value });
      }),
    );
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(headers, (input) => {
        const once = redactHeaders(input);
        expect(redactHeaders(once)).toEqual(once);
      }),
    );
  });
});
