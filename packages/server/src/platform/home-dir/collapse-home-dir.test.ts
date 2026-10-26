import { describe, expect, it } from "vitest";
import { collapseHomeDir } from "./collapse-home-dir.js";

describe("collapseHomeDir", () => {
  it("replaces a POSIX home prefix with ~", () => {
    expect(
      collapseHomeDir("/home/alice/.config/Code/User/settings.json", "/home/alice"),
    ).toBe("~/.config/Code/User/settings.json");
  });

  it("replaces a Windows home prefix with ~, keeping backslashes", () => {
    expect(
      collapseHomeDir(
        "C:\\Users\\alice\\AppData\\Roaming\\Code\\User\\settings.json",
        "C:\\Users\\alice",
      ),
    ).toBe("~\\AppData\\Roaming\\Code\\User\\settings.json");
  });

  it("collapses the home directory itself to ~", () => {
    expect(collapseHomeDir("/home/alice", "/home/alice")).toBe("~");
  });

  it("ignores a trailing separator on the home directory", () => {
    expect(collapseHomeDir("/home/alice/x.json", "/home/alice/")).toBe("~/x.json");
  });

  it("does not collapse a sibling directory sharing the prefix", () => {
    expect(collapseHomeDir("/home/alice/x.json", "/home/al")).toBe("/home/alice/x.json");
  });

  it("leaves paths outside the home directory unchanged", () => {
    expect(collapseHomeDir("/etc/code/settings.json", "/home/alice")).toBe(
      "/etc/code/settings.json",
    );
  });

  it("leaves text unchanged when the home directory is empty or the root", () => {
    expect(collapseHomeDir("/etc/x.json", "")).toBe("/etc/x.json");
    expect(collapseHomeDir("/etc/x.json", "/")).toBe("/etc/x.json");
  });
});
