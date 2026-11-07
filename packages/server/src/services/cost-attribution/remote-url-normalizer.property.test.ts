// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalizeRemoteUrl } from "./remote-url-normalizer.js";

// Phase 15 step 15.2 exit criterion: no credential survives into a key.
// Hosts and paths use letters only and secrets always contain digits, so a
// secret can't appear in a correct key by coincidence.
const label = fc.stringMatching(/^[a-z][a-z-]{0,10}[a-z]$/);
const host = fc.array(label, { minLength: 2, maxLength: 3 }).map((parts) => parts.join("."));
const pathSegments = fc.array(label, { minLength: 1, maxLength: 4 });
const user = fc.stringMatching(/^[a-z][a-z0-9_]{0,10}$/);
const secret = fc.stringMatching(/^[A-Za-z]{0,6}[0-9][A-Za-z0-9_]{6,20}$/);
const port = fc.integer({ min: 1, max: 65535 });

describe("normalizeRemoteUrl (properties)", () => {
  it("never keeps a password or token, and keeps only host and path", () => {
    fc.assert(
      fc.property(
        host,
        pathSegments,
        user,
        secret,
        fc.option(port, { nil: undefined }),
        fc.constantFrom("https", "http", "ssh", "git+ssh"),
        fc.boolean(),
        (h, segments, u, s, p, scheme, dotGit) => {
          const portPart = p === undefined ? "" : `:${p}`;
          const url = `${scheme}://${u}:${s}@${h}${portPart}/${segments.join("/")}${dotGit ? ".git" : ""}`;

          const key = normalizeRemoteUrl(url);

          expect(key).toBe(`${h}/${segments.join("/")}`);
          expect(key!.toLowerCase()).not.toContain(s.toLowerCase());
          expect(key).not.toMatch(/[@:]/);
        },
      ),
    );
  });

  it("never returns a key containing a secret passed as the user part alone", () => {
    fc.assert(
      fc.property(host, pathSegments, secret, (h, segments, s) => {
        const key = normalizeRemoteUrl(`https://${s}@${h}/${segments.join("/")}`);

        expect(key).toBe(`${h}/${segments.join("/")}`);
        expect(key!.toLowerCase()).not.toContain(s.toLowerCase());
      }),
    );
  });

  it("maps the scp-like and https forms of one remote to the same key", () => {
    fc.assert(
      fc.property(host, pathSegments, (h, segments) => {
        const path = segments.join("/");

        expect(normalizeRemoteUrl(`git@${h}:${path}.git`)).toBe(normalizeRemoteUrl(`https://${h}/${path}`));
      }),
    );
  });

  it("never throws on arbitrary input, and never returns a key with an @", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (input) => {
        const key = normalizeRemoteUrl(input);
        expect(key === null || typeof key === "string").toBe(true);
        expect(key ?? "").not.toContain("@");
      }),
    );
  });
});
