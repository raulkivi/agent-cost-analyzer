import path from "node:path";
import { describe, expect, it } from "vitest";
import { userDataDirFromGlobalStorage } from "./vscode-user-data-dir.js";

const EXTENSION_ID = "raulkivi.ai-credits-analyzer";

// D4: context.globalStorageUri is <userData>/User/globalStorage/<extension-id>.
describe("userDataDirFromGlobalStorage (vscode-extension.md D4, G5)", () => {
  it.each([
    ["Linux", "/home/u/.config/Code/User/globalStorage/" + EXTENSION_ID, "/home/u/.config/Code"],
    ["macOS", "/Users/u/Library/Application Support/Code/User/globalStorage/" + EXTENSION_ID, "/Users/u/Library/Application Support/Code"],
    ["Insiders", "/home/u/.config/Code - Insiders/User/globalStorage/" + EXTENSION_ID, "/home/u/.config/Code - Insiders"],
    ["portable", "/opt/vscode/data/user-data/User/globalStorage/" + EXTENSION_ID, "/opt/vscode/data/user-data"],
    ["a remote server", "/home/u/.vscode-server/data/User/globalStorage/" + EXTENSION_ID, "/home/u/.vscode-server/data"],
    ["a trailing separator", "/home/u/.config/Code/User/globalStorage/" + EXTENSION_ID + "/", "/home/u/.config/Code"],
  ])("derives the user-data dir on %s", (_label, globalStoragePath, expected) => {
    expect(userDataDirFromGlobalStorage(globalStoragePath, path.posix)).toBe(expected);
  });

  it("derives the user-data dir on Windows", () => {
    expect(
      userDataDirFromGlobalStorage(`C:\\Users\\x\\AppData\\Roaming\\Code\\User\\globalStorage\\${EXTENSION_ID}`, path.win32),
    ).toBe("C:\\Users\\x\\AppData\\Roaming\\Code");
  });

  it("derives the user-data dir for a Windows portable install", () => {
    expect(userDataDirFromGlobalStorage(`D:\\vscode\\data\\user-data\\User\\globalStorage\\${EXTENSION_ID}`, path.win32)).toBe(
      "D:\\vscode\\data\\user-data",
    );
  });

  it("defaults to the running platform's path rules", () => {
    const dir = path.join(path.sep, "ud");

    expect(userDataDirFromGlobalStorage(path.join(dir, "User", "globalStorage", EXTENSION_ID))).toBe(dir);
  });

  it.each([
    ["an empty path", ""],
    ["a relative path", "User/globalStorage/" + EXTENSION_ID],
    ["a different storage dir", "/home/u/.config/Code/User/workspaceStorage/" + EXTENSION_ID],
    ["no User parent", "/home/u/.config/Code/Config/globalStorage/" + EXTENSION_ID],
    ["no extension-id segment", "/home/u/.config/Code/User/globalStorage"],
    ["a case mismatch", "/home/u/.config/Code/user/globalstorage/" + EXTENSION_ID],
    ["a path too short to hold the layout", "/globalStorage/" + EXTENSION_ID],
    ["the root", "/"],
  ])("returns null for %s, without guessing", (_label, globalStoragePath) => {
    expect(userDataDirFromGlobalStorage(globalStoragePath, path.posix)).toBeNull();
  });

  it("returns null for a Windows path under the posix rules (no guessing across platforms)", () => {
    expect(userDataDirFromGlobalStorage(`C:\\Users\\x\\Code\\User\\globalStorage\\${EXTENSION_ID}`, path.posix)).toBeNull();
  });
});
