// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { InMemoryFileSystem } from "../../test-support/in-memory-file-system.js";
import { RepositoryResolver } from "./repository-resolver.js";

// Phase 15 step 15.2 exit criterion: whatever credential a remote is written
// with, or a recorded repository carries, none appears in the resolver's
// output. Secrets always contain a digit and the names are letters only, so
// a secret can't appear in a correct result by coincidence.
const label = fc.stringMatching(/^[a-z][a-z-]{0,8}[a-z]$/);
const host = fc.array(label, { minLength: 2, maxLength: 3 }).map((parts) => parts.join("."));
const repoPath = fc.array(label, { minLength: 1, maxLength: 3 }).map((parts) => parts.join("/"));
const secret = fc.stringMatching(/^[A-Za-z]{0,4}[0-9][A-Za-z0-9_]{7,20}$/);
const remoteWithSecret = fc
  .tuple(host, repoPath, secret, fc.constantFrom("https", "http", "ssh", "git+ssh"), fc.boolean())
  .map(([h, p, s, scheme, asPassword]) => ({
    url: asPassword ? `${scheme}://user:${s}@${h}/${p}.git` : `${scheme}://${s}@${h}/${p}`,
    secret: s,
  }));

describe("RepositoryResolver (properties)", () => {
  it("never returns a credential from a remote in the git config", () => {
    fc.assert(
      fc.property(remoteWithSecret, ({ url, secret: s }) => {
        const fs = new InMemoryFileSystem({ "/home/dev/app/.git/config": `[remote "origin"]\n\turl = ${url}\n` });

        const output = JSON.stringify(new RepositoryResolver(fs).resolve({ known: true, cwd: "/home/dev/app" }));

        expect(output.toLowerCase()).not.toContain(s.toLowerCase());
      }),
    );
  });

  it("never returns a credential from a recorded repository of a missing folder", () => {
    fc.assert(
      fc.property(remoteWithSecret, ({ url, secret: s }) => {
        const output = JSON.stringify(
          new RepositoryResolver(new InMemoryFileSystem({})).resolve({ known: true, cwd: "/gone/app", repositoryHint: url }),
        );

        expect(output.toLowerCase()).not.toContain(s.toLowerCase());
      }),
    );
  });
});
