# Security Policy

**Last changed:** 2026-11-15 · **Source:** https://github.com/raulkivi/agent-cost-analyzer

## Supported versions
Only the latest release receives security fixes.

## Distribution channels
The standalone app is published on npm as
[`agent-cost-analyzer`](https://www.npmjs.com/package/agent-cost-analyzer)
(from app 0.16.0); the extension is on the VS Code Marketplace and Open VSX.
Each release is built by a GitHub Actions workflow from a tag in this
repository and published through trusted publishing (OIDC), with no
long-lived publishing token. The npm package has no dependencies and no
install scripts.

Verify an npm install: the package page shows a provenance link to the
workflow run and commit. In a project that installed it, `npm audit
signatures` checks the registry signature and the provenance attestation of
every installed package. Use the exact name `agent-cost-analyzer` (with a
z). A package that has no provenance link back to
`github.com/raulkivi/agent-cost-analyzer` is not this one.

## Reporting a vulnerability
Report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/raulkivi/agent-cost-analyzer/security/advisories/new). Do not open a public issue.

Include:
- affected version or commit
- steps to reproduce or a proof of concept
- impact as you understand it

## What to expect
- Acknowledgement within 7 days.
- An assessment and, if confirmed, a fix plan within 30 days.
- Credit in the advisory unless you ask otherwise.

This is a personal project maintained on a best-effort basis.
