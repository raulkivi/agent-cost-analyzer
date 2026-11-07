// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { normalizeRemoteUrl } from "./remote-url-normalizer.js";

// Phase 15 step 15.2 (plan §4.2, §12.1): every way a remote is written maps
// to one key, with no scheme, user, password, token, port or ".git".
describe("normalizeRemoteUrl", () => {
  const cases: [string, string][] = [
    ["git@github.com:Org/App.git", "github.com/org/app"],
    ["https://github.com/org/app", "github.com/org/app"],
    ["https://x:TOKEN123@github.com/org/app", "github.com/org/app"],
    ["https://ghp_abc123@github.com/org/app.git", "github.com/org/app"],
    ["https://github.com/org/app.git/", "github.com/org/app"],
    ["http://GitHub.COM/Org/App", "github.com/org/app"],
    ["ssh://git@github.com:22/org/app.git", "github.com/org/app"],
    ["ssh://git@github.com/org/app", "github.com/org/app"],
    ["git+ssh://git@github.com/org/app.git", "github.com/org/app"],
    ["git://github.com/org/app.git", "github.com/org/app"],
    ["  https://github.com/org/app  ", "github.com/org/app"],
    ["https://git.example.com:8443/team/app.git", "git.example.com/team/app"],
    ["https://github.com/org/my%20app", "github.com/org/my app"],
    // GitLab subgroups keep every segment.
    ["https://gitlab.com/group/sub/repo.git", "gitlab.com/group/sub/repo"],
    ["git@gitlab.example.com:group/sub/deeper/repo.git", "gitlab.example.com/group/sub/deeper/repo"],
    // Azure DevOps: one key for its HTTPS, SSH and old visualstudio.com forms.
    ["https://dev.azure.com/org/project/_git/repo", "dev.azure.com/org/project/repo"],
    ["https://org@dev.azure.com/org/project/_git/repo", "dev.azure.com/org/project/repo"],
    ["git@ssh.dev.azure.com:v3/org/project/repo", "dev.azure.com/org/project/repo"],
    ["https://org.visualstudio.com/project/_git/repo", "dev.azure.com/org/project/repo"],
    ["https://org.visualstudio.com/DefaultCollection/project/_git/repo", "dev.azure.com/org/project/repo"],
    ["org@vs-ssh.visualstudio.com:v3/org/project/repo", "dev.azure.com/org/project/repo"],
  ];

  it.each(cases)("%s → %s", (url, key) => {
    expect(normalizeRemoteUrl(url)).toBe(key);
  });

  // A local or file remote isn't a shared identity, so the caller falls back
  // to the repository's local root.
  it.each([
    "",
    "   ",
    "/srv/git/app.git",
    "../other-repo",
    "file:///srv/git/app.git",
    "C:\\repos\\app",
    "https://github.com",
    "https://github.com/",
    "git@github.com:",
    "not a url",
    "https://github.com/org/../../etc",
    // An "@" in the path means userinfo in the wrong place; nothing of it may become a key.
    "user:pass@host",
    "https://github.com/org/app@token123",
  ])("returns null for %j", (url) => {
    expect(normalizeRemoteUrl(url)).toBeNull();
  });
});
