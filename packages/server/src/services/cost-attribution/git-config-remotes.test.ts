import { describe, expect, it } from "vitest";
import { parseGitConfigRemotes, preferredRemoteUrl } from "./git-config-remotes.js";

const CONFIG = `[core]
	repositoryformatversion = 0
	bare = false
[remote "upstream"]
	url = https://github.com/upstream/app.git
	fetch = +refs/heads/*:refs/remotes/upstream/*
[remote "origin"]
	url = git@github.com:me/app.git ; my fork
	fetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
	remote = origin
`;

describe("parseGitConfigRemotes", () => {
  it("lists each remote with its url, in file order", () => {
    expect(parseGitConfigRemotes(CONFIG)).toEqual([
      { name: "upstream", url: "https://github.com/upstream/app.git" },
      { name: "origin", url: "git@github.com:me/app.git" },
    ]);
  });

  it("is case-insensitive for section and key names, keeps the remote name's case, and reads quoted values", () => {
    const config = `[REMOTE "Origin"]\n  URL = "https://example.com/team/app.git" # comment\n`;
    expect(parseGitConfigRemotes(config)).toEqual([{ name: "Origin", url: "https://example.com/team/app.git" }]);
  });

  it("skips comments, blank lines, remotes without a url and other sections", () => {
    const config = `# top comment\n; another\n\n[remote "empty"]\n  fetch = x\n[user]\n  url = not-a-remote\n`;
    expect(parseGitConfigRemotes(config)).toEqual([]);
  });

  it("takes the first url when a remote lists several", () => {
    const config = `[remote "origin"]\n  url = https://a.example/x/app\n  url = https://b.example/x/app\n`;
    expect(parseGitConfigRemotes(config)).toEqual([{ name: "origin", url: "https://a.example/x/app" }]);
  });

  it("never throws on garbage", () => {
    expect(parseGitConfigRemotes("[remote \"x\n url == = \n\u0000")).toEqual([]);
  });
});

describe("preferredRemoteUrl", () => {
  it("prefers origin, else the first remote, else null", () => {
    expect(preferredRemoteUrl(parseGitConfigRemotes(CONFIG))).toBe("git@github.com:me/app.git");
    expect(preferredRemoteUrl([{ name: "upstream", url: "u" }, { name: "fork", url: "f" }])).toBe("u");
    expect(preferredRemoteUrl([])).toBeNull();
  });
});
