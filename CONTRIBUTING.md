# Contributing to SpentOn

Keep one product and the same budgeting rules across Cloud and self-hosting.
Describe the problem, resulting behavior and validation when proposing a change.

## Run locally

Use Node.js 22.18+ within the 22.x line.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5417. The local development server uses a local SQLite database. Never copy
production data or credentials into development, fixtures or support reports.

Before submitting a change:

```sh
npm run check:fast
```

This runs the exported package’s core tests, self-hosted server checks and build.
Add focused tests for money calculations, authorization and save-retry behavior.

## Product rules

- Store money in integer minor units. Purchases and refunds determine spending;
  transfers and card payments must not count it again.
- Derive identity and ownership from the authenticated server session.
- Preserve optimistic revisions and idempotent retries. A lost response does
  not establish that a save failed.
- Keep personal budgets private. Sharing works within one installation.
- Explain actions and their consequences clearly. Respect keyboard navigation,
  reduced motion and native accessibility.

## Contributions and notices

Contributions to the product use AGPL-3.0-only. Contributors retain copyright.
Identify any third-party material and preserve its license and attribution.
A contribution does not grant permission to relicense someone else’s work.
See LICENSE_SCOPE.md for asset permissions.

Do not submit credentials, personal records or private provider configuration.
Report security issues through SECURITY.md, rather than a public issue.

## Propose a change

Read the [community guidelines](CODE_OF_CONDUCT.md). Open an issue before a
large change so maintainers can discuss its scope. Fork this public repository,
create a branch, and open a pull request against `main`. Explain the problem,
resulting behavior and checks. Small documentation corrections can go directly
to a pull request.

Contributions are reviewed in public. Maintainers may carry an accepted change
into the development repository and publish later updates here. Your original
authorship and license remain intact. There is no contributor license agreement
or automatic grant to relicense your work.

The web uses React, TypeScript and Vite; the server uses Node.js 22 and SQLite.
Native source is included for development. `npm run ios:prepare` also needs
Python 3; compilation requires macOS and Xcode with the appropriate iOS SDK.
Supply your own local signing configuration. This command does not publish an app.
