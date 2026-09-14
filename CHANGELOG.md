# SpentOn release notes

## 0.4.0-rc.3 — 14 September 2026

First public web and self-hosted beta under AGPL-3.0-only.

- Install with Docker Compose and a local username and password. No email service, domain, Cloud activation or separate Node.js installation is required.
- Plan envelopes, category carryover and savings goals; track manual accounts, purchases, refunds, recurring expenses and credit-card cash backing.
- Review CSV imports, split bills and repayments with accounts on the same server.
- Keep accounts and budgets in persistent storage, resolve interrupted saves without duplication, and retain daily backups and deletion records.
- Recover passwords locally and export budgets or delete accounts in the app.
- Include community guidelines, development instructions, dependency notices and a file-hash manifest.

This is a beta. The default Docker profile is local to its host computer.
Official native binaries are not included. Native source remains available for
development. End-to-end encryption is not implemented. Paid Cloud checkout
remains subject to separate provider verification.

Before upgrading an existing installation, preserve data, private settings,
backups and the deletion ledger. Existing email accounts are not automatically
converted. Keep operation outcomes and guards when reverting application code;
a code rollback is not a database restore.
