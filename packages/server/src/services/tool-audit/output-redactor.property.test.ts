import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { excerptOf, redactSecrets } from "./output-redactor.js";

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

// Bodies are drawn from each regex's own character class and length bound, so a
// pattern edit that narrows the class or raises the minimum is caught here.
const body = (chars: string, min: number, max = min) =>
  fc.string({ unit: fc.constantFrom(...chars), minLength: min, maxLength: max });

const jwtPart = body(`${ALNUM}_-`, 5, 20);

// Each entry yields the full secret and the part that must not survive redaction.
const SECRET_FORMATS: Record<string, fc.Arbitrary<{ secret: string; sensitive: string }>> = {
  "GitHub token": fc
    .tuple(fc.constantFrom("ghp", "gho", "ghu", "ghs", "ghr"), body(ALNUM, 20, 40))
    .map(([kind, b]) => ({ secret: `${kind}_${b}`, sensitive: b })),
  "GitHub fine-grained PAT": body(`${ALNUM}_`, 20, 60).map((b) => ({ secret: `github_pat_${b}`, sensitive: b })),
  "sk- key": body(`${ALNUM}_-`, 16, 60).map((b) => ({ secret: `sk-${b}`, sensitive: b })),
  "AWS access key id": body("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 16).map((b) => ({ secret: `AKIA${b}`, sensitive: b })),
  "Google API key": body(`${ALNUM}_-`, 35).map((b) => ({ secret: `AIza${b}`, sensitive: b })),
  "Stripe key": fc
    .tuple(fc.constantFrom("sk", "rk"), fc.constantFrom("live", "test"), body(ALNUM, 16, 40))
    .map(([kind, env, b]) => ({ secret: `${kind}_${env}_${b}`, sensitive: b })),
  "npm token": body(ALNUM, 36).map((b) => ({ secret: `npm_${b}`, sensitive: b })),
  "GitLab PAT": body(`${ALNUM}_-`, 20, 40).map((b) => ({ secret: `glpat-${b}`, sensitive: b })),
  "Hugging Face token": body(ALNUM, 30, 50).map((b) => ({ secret: `hf_${b}`, sensitive: b })),
  "Slack token": fc
    .tuple(fc.constantFrom("a", "b", "p", "r", "s"), body(`${ALNUM}-`, 10, 40))
    .map(([kind, b]) => ({ secret: `xox${kind}-${b}`, sensitive: b })),
  JWT: fc
    .tuple(jwtPart, jwtPart, body(`${ALNUM}_-`, 1, 20))
    .map(([h, p, s]) => ({ secret: `eyJ${h}.eyJ${p}.${s}`, sensitive: p })),
  "PEM private key": fc
    .tuple(fc.constantFrom("", "RSA ", "EC ", "OPENSSH ", "ENCRYPTED "), body(`${ALNUM}+/=`, 8, 80))
    .map(([kind, b]) => ({
      secret: `-----BEGIN ${kind}PRIVATE KEY-----\n${b}\n-----END ${kind}PRIVATE KEY-----`,
      sensitive: b,
    })),
};

// Surrounding text is arbitrary but whitespace-separated, matching how secrets
// appear in real terminal output.
const text = fc.string({ maxLength: 40 });

// Starts with a digit so it cannot be mistaken for any fixed text the redactor emits.
const credentialValue = fc
  .tuple(fc.constantFrom(..."0123456789"), body(ALNUM, 7, 30))
  .map(([digit, rest]) => `${digit}${rest}`);

const randomCase = (word: string) =>
  fc.array(fc.boolean(), { minLength: word.length, maxLength: word.length }).map((flags) =>
    [...word].map((ch, i) => (flags[i] ? ch.toUpperCase() : ch.toLowerCase())).join(""),
  );

describe("redactSecrets (property-based)", () => {
  for (const [format, arbitrary] of Object.entries(SECRET_FORMATS)) {
    it(`never leaks a ${format} embedded in arbitrary text`, () => {
      fc.assert(
        fc.property(text, arbitrary, text, (before, { secret, sensitive }, after) => {
          const output = redactSecrets(`${before} ${secret} ${after}`);
          expect(output).not.toContain(sensitive);
        }),
      );
    });
  }

  // Minimum-length tokens ending in "-" were once missed because the closing \b could not
  // match after a trailing "-"; the lookahead bounds in output-redactor.ts fixed that.
  it("never leaks a minimum-length sk- or Slack token that ends in a hyphen", () => {
    fc.assert(
      fc.property(
        text,
        fc.oneof(
          body(ALNUM, 15).map((b) => ({ secret: `sk-${b}-`, sensitive: `${b}-` })),
          body(ALNUM, 9).map((b) => ({ secret: `xoxb-${b}-`, sensitive: `${b}-` })),
        ),
        text,
        (before, { secret, sensitive }, after) => {
          expect(redactSecrets(`${before} ${secret} ${after}`)).not.toContain(sensitive);
        },
      ),
    );
  });

  it("never leaks a Bearer, Basic or token credential in any casing", () => {
    fc.assert(
      fc.property(
        text,
        randomCase("bearer").chain((b) => fc.constantFrom(b, "Basic", "basic", "BASIC", "token", "TOKEN", "Token")),
        fc.string({ unit: fc.constantFrom(..."0123456789"), minLength: 1, maxLength: 1 }),
        body(`${ALNUM}._~+/=-`, 7, 30),
        text,
        (before, scheme, digit, rest, after) => {
          const value = `${digit}${rest}`;
          expect(redactSecrets(`${before} ${scheme} ${value} ${after}`)).not.toContain(value);
        },
      ),
    );
  });

  it("never leaks the value of a password=/api_key:-style assignment in any casing", () => {
    const key = fc
      .constantFrom("password", "passwd", "pwd", "secret", "token", "api_key", "api-key", "apikey", "access_key", "access-key")
      .chain(randomCase);
    fc.assert(
      fc.property(text, key, fc.constantFrom("=", ":", " = ", ": "), credentialValue, text, (before, name, sep, value, after) => {
        expect(redactSecrets(`${before} ${name}${sep}${value} ${after}`)).not.toContain(value);
      }),
    );
  });

  it("is idempotent on arbitrary strings", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (input) => {
        const once = redactSecrets(input);
        expect(redactSecrets(once)).toBe(once);
      }),
    );
  });

  it("is idempotent on text assembled from secret-like fragments", () => {
    const fragment = fc.oneof(
      fc.constantFrom("Bearer ", "token ", "password=", "api_key: ", "sk-", "ghp_", "eyJ", ".", " ", "\n", "[REDACTED]", "-----BEGIN PRIVATE KEY-----"),
      body(`${ALNUM}_-`, 1, 24),
    );
    fc.assert(
      fc.property(fc.array(fragment, { maxLength: 12 }).map((parts) => parts.join("")), (input) => {
        const once = redactSecrets(input);
        expect(redactSecrets(once)).toBe(once);
      }),
    );
  });

  it("leaves text with no letters unchanged", () => {
    // Every pattern needs a letter, so digits/whitespace/punctuation can only be a false positive.
    const letterless = fc.string({
      unit: fc.constantFrom(...[..."0123456789 \t\n\r", ..."!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"]),
      maxLength: 200,
    });
    fc.assert(
      fc.property(letterless, (input) => {
        expect(redactSecrets(input)).toBe(input);
      }),
    );
  });
});

describe("excerptOf (property-based)", () => {
  it("never exceeds maxLength", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), fc.integer({ min: 1, max: 100 }), (input, maxLength) => {
        expect(excerptOf(input, maxLength).length).toBeLessThanOrEqual(maxLength);
      }),
    );
  });

  it("never leaks a secret, whatever the truncation length", () => {
    fc.assert(
      fc.property(
        text,
        SECRET_FORMATS["GitHub token"],
        text,
        fc.integer({ min: 1, max: 200 }),
        (before, { sensitive }, after, maxLength) => {
          expect(excerptOf(`${before} ghp_${sensitive} ${after}`, maxLength)).not.toContain(sensitive);
        },
      ),
    );
  });
});
