# agent-cost-analyzer

**Last changed:** 2026-11-15 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

See where the tokens and money go when an AI agent writes code for you. This
package runs the standalone **Agent Cost Analyzer** app: it reads the session
logs that GitHub Copilot Chat, Claude Code and the pi coding agent already
write on your machine and shows every session turn by turn. It also has a
Learn mode with sample sessions, so it is useful before you have any data.

Independent project; not affiliated with or endorsed by GitHub, Microsoft,
Anthropic or the pi project.

## Run it

Needs Node.js 22.18 or newer.

```sh
npx agent-cost-analyzer
```

The app starts on http://127.0.0.1:5199 and opens in your browser. If it is
already running, a second start opens that instance. If another program holds
port 5199, it takes the next free port (up to ten) and prints which.
`npx agent-cost-analyzer@latest` runs the newest release.

| Option | Does |
|---|---|
| `--port <n>` | Uses that port only; `0` takes any free port. Fails if the port is busy |
| `--no-open` | Starts without opening a browser |
| `--help`, `-h` | Prints usage |
| `--version`, `-v` | Prints the version |

Ctrl+C stops the app. It never listens beyond `127.0.0.1`; there is no
`--host` option.

## Ask your AI chat

`agent-cost-analyzer mcp` runs the same analysis as a read-only MCP server
over stdio, so an MCP client can answer "what drove my spend this week?". The
interactive views for hosts that support MCP Apps are included.

```sh
claude mcp add agent-cost-analyzer -- npx -y --prefer-offline agent-cost-analyzer mcp
```

- `--prefer-offline` starts the cached copy at once when the npm registry is
  unreachable; without it, `npx` waits about a minute of retries first.
- On Windows, a client that does not resolve `.cmd` files needs
  `cmd /c npx -y --prefer-offline agent-cost-analyzer mcp`.
- To run fully offline or on a pinned version, run
  `npm install -g agent-cost-analyzer` once, then register
  `agent-cost-analyzer mcp` as the command.
- `--project-billing-details` after `mcp` also shares client names and
  billing codes with the client.

## Privacy

- Everything runs on your machine; the app sends no data anywhere and makes
  no network call of its own (`npx` itself talks to the npm registry).
- It only reads your tools' session logs. The one place it writes is its own
  settings folder: `~/.config/agent-cost-analyzer` on Linux,
  `~/Library/Application Support/agent-cost-analyzer` on macOS and
  `%APPDATA%\agent-cost-analyzer` on Windows.
- The package has no dependencies and no install scripts, and each release
  carries an npm provenance attestation that links to the source commit.

## More

- [Setup and data sources](https://github.com/raulkivi/agent-cost-analyzer/blob/main/docs/standalone-app.md)
- [User Guide](https://github.com/raulkivi/agent-cost-analyzer/blob/main/docs/UserGuide.md)
- [Security policy and how to verify a release](https://github.com/raulkivi/agent-cost-analyzer/blob/main/SECURITY.md)
- [Changelog](https://github.com/raulkivi/agent-cost-analyzer/blob/main/CHANGELOG.md)
- [Report a problem](https://github.com/raulkivi/agent-cost-analyzer/issues)

MIT licensed. Third-party licenses: `THIRD-PARTY-NOTICES.md` in this package.
