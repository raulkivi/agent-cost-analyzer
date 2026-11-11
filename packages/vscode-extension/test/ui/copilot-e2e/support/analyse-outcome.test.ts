// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { analyseOutcome } from "./analyse-outcome.mts";

const NO_BREAK_SPACE = String.fromCharCode(0xa0);

// A33: U5's Analyse in a real Copilot Chat (owner, 2026-11-11, §9.2 Q7: try,
// then fall back). Either the chat gains exactly one request, with the fixed
// text, or VS Code puts exactly that text in the chat input (staged), or the
// row shows the text to type; anything else fails. The chat
// list is virtualised, so "one new request" is the analyzer's turn count and
// the text is read from the requests the chat shows.
describe("analyseOutcome", () => {
  const sessionId = "00000008-0000-4000-a000-000000000008";
  const message = "Analyse session 00000008-0000-4000-a000-000000000008";
  const prompt = "Call these all 6 ai-credits-analyzer MCP tools …";

  it("is sent when the chat gained one turn, shows one request with the fixed text, and the view says Sent", () => {
    const outcome = analyseOutcome({ sessionId, turnsBefore: 1, turnsAfter: 2, requestTexts: [prompt, message], row: "sent" });

    expect(outcome).toEqual({ kind: "sent", request: message });
  });

  it("reads the request's text with VS Code's spacing collapsed", () => {
    const outcome = analyseOutcome({ sessionId, turnsBefore: 1, turnsAfter: 2, requestTexts: [`  Analyse session\n${sessionId} `], row: "sent" });

    expect(outcome.kind).toBe("sent");
  });

  it("is the fallback when the chat gained no turn and the row shows the text to type", () => {
    const outcome = analyseOutcome({ sessionId, turnsBefore: 1, turnsAfter: 1, requestTexts: [prompt], row: "fallback" });

    expect(outcome).toEqual({ kind: "fallback", text: `Ask in the chat: ${message}` });
  });

  // VS Code 1.146 (A33's first run): the view's message is accepted, but it
  // lands in the chat input, unsent; the user still presses Enter.
  it("is staged when the chat gained no turn, its input holds exactly the fixed text, and the view says Sent", () => {
    const outcome = analyseOutcome({ sessionId, turnsBefore: 1, turnsAfter: 1, requestTexts: [prompt], row: "sent", inputText: `${message}${NO_BREAK_SPACE}` });

    expect(outcome).toEqual({ kind: "staged", input: message });
  });

  it("fails when the input holds other text after a Sent", () => {
    const outcome = analyseOutcome({ sessionId, turnsBefore: 1, turnsAfter: 1, requestTexts: [prompt], row: "sent", inputText: `${message} Placeholder portal-web session 8` });

    expect(outcome).toEqual({ kind: "failed", reason: expect.stringMatching(/input holds something else/) });
  });

  it.each([
    ["another text", 2, ["Analyse session 00000007-0000-4000-a000-000000000007"], "sent", /no request shows the fixed text/],
    ["extra words", 2, [`${message} Placeholder portal-web session 8`], "sent", /no request shows the fixed text/],
    ["the text twice", 2, [message, message], "sent", /2 requests show the fixed text/],
    ["two new turns", 3, [message], "sent", /2 new chat requests/],
    ["a request and the fallback", 2, [message], "fallback", /both/],
    ["Sent with no new turn", 1, [prompt], "sent", /says Sent but the chat gained no request/],
    ["the text with no new turn", 1, [message], "pending", /shows the fixed text but gained no turn/],
    ["nothing at all", 1, [prompt], "pending", /neither/],
  ] as const)("fails on %s", (_name, turnsAfter, requestTexts, row, reason) => {
    const outcome = analyseOutcome({ sessionId, turnsBefore: 1, turnsAfter, requestTexts, row });

    expect(outcome.kind).toBe("failed");
    expect(outcome.kind === "failed" && outcome.reason).toMatch(reason);
  });
});
