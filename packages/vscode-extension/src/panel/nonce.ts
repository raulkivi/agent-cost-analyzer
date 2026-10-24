import { randomBytes } from "node:crypto";

// A fresh CSP nonce for each render of the panel's HTML (vscode-extension.md
// §5): 128 random bits, base64.
export function createNonce(): string {
  return randomBytes(16).toString("base64");
}
