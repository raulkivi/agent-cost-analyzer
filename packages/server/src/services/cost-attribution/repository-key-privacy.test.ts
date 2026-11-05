import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { keyMatches, redactKeysInText, redactRepositoryKey } from "./repository-key-privacy.js";

describe("redactRepositoryKey (plan §10.1.5)", () => {
  it("keeps a normalised remote key as it is", () => {
    expect(redactRepositoryKey("github.com/acme/portal")).toBe("github.com/acme/portal");
    expect(redactRepositoryKey("repository:acme/portal")).toBe("repository:acme/portal");
  });

  it("returns local: and path: keys as the folder's name only", () => {
    expect(redactRepositoryKey("local:/home/dev/scratch")).toBe("local:scratch");
    expect(redactRepositoryKey("path:/home/dev/notes/")).toBe("path:notes");
    expect(redactRepositoryKey("path:C:\\Users\\dev\\notes")).toBe("path:notes");
    expect(redactRepositoryKey("path:/")).toBe("path:");
  });

  it("never returns any folder above the last one (property)", () => {
    const segment = fc.stringMatching(/^[A-Za-z0-9._-]{1,12}$/);
    fc.assert(
      fc.property(fc.array(segment, { minLength: 2, maxLength: 6 }), fc.constantFrom("local:", "path:"), fc.constantFrom("/", "\\"), (parts, prefix, sep) => {
        const redacted = redactRepositoryKey(`${prefix}${sep}${parts.join(sep)}`);
        expect(redacted).toBe(`${prefix}${parts.at(-1)}`);
        expect(redacted).not.toContain("/");
        expect(redacted).not.toContain("\\");
      }),
    );
  });
});

describe("keyMatches", () => {
  it("matches a filter given as the full key or as its redacted form", () => {
    expect(keyMatches("local:/home/dev/scratch", "local:/home/dev/scratch")).toBe(true);
    expect(keyMatches("local:/home/dev/scratch", "local:scratch")).toBe(true);
    expect(keyMatches("github.com/acme/portal", "GitHub.com/Acme/Portal")).toBe(true);
    expect(keyMatches("github.com/acme/portal", "github.com/acme/other")).toBe(false);
  });
});

describe("redactKeysInText", () => {
  it("replaces each local key named in a message with its redacted form", () => {
    const text = 'aliases["path:/home/dev/old"]: path:/home/dev/old points to local:/home/dev/app, which is itself an alias';
    expect(redactKeysInText(text, ["path:/home/dev/old", "local:/home/dev/app", "github.com/acme/portal"])).toBe(
      'aliases["path:old"]: path:old points to local:app, which is itself an alias',
    );
  });
});
