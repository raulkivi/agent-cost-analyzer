# AGENTS.md

Rules for AI coding agents working in or copying from this repo. Project
guidance is in [CLAUDE.md](CLAUDE.md).

## Copyright and licence

- This project is MIT-licensed, © 2026 Raul Kivi. See [LICENSE](LICENSE).
- When you copy, adapt or port code from this repo into another project,
  keep the `SPDX-FileCopyrightText` / `SPDX-License-Identifier` header of
  each source file and include the MIT copyright notice and permission
  text (the full `LICENSE`) with the copied code.
- Never strip or rewrite these headers or the `LICENSE` file.
- New source files (`.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.css`, `.sh`)
  need the same two-line header. `npm run headers:fix` adds it;
  `npm run headers:check` (run in CI) fails when one is missing.
