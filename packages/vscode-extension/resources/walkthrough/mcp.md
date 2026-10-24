# Ask Copilot about your costs

AI Credits Analyzer can answer questions such as "what did my last session
cost?" or "which commands keep failing?" in Copilot Chat, through a
**read-only MCP server** that reads the same local logs as the analyzer.

## Turn it on

Set **`aiCreditsAnalyzer.mcp.enabled`** to on. It's off by default. Copilot
Chat can then use the AI Credits Analyzer tools in agent mode. Turn the
setting off again and the server is no longer offered.

## What the model sees

When it's on, read-only and redacted Copilot Chat session data is sent to
whichever model the chat uses:

- costs: tokens, AI Credits and cache use per session, turn and day;
- tool calls and their outcomes;
- findings: security, anomaly and behaviour-change flags, with excerpts;
- turn text: your prompts and the responses.

Secrets found in that text are redacted first, and the text is cut to a
bounded length. The server never writes files, runs commands or reaches
the network, and it reads only Copilot Chat's logs on this machine.
