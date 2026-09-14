<p align="center"><img src="public/brand/spenton-pip-planning-art.webp" alt="Pip planning money into SpentOn budget envelopes" width="520"></p>

# SpentOn — open-source envelope budgeting

**Comprehensive, open-source envelope budgeting.** Your budget. Your choice.

SpentOn is a personal finance app for planning the money you have, tracking
spending, preparing for bills and managing shared expenses. Self-host it for
free with Docker and a local password, or choose the optional managed
[SpentOn Cloud](https://spenton.dev/) service.

[Download the beta](https://github.com/aliacollins/spenton-community/releases/tag/v0.4.0-rc.3) ·
[Try the example budget](https://spenton.dev/landing/#product) ·
[Ask the community](https://www.reddit.com/r/Spenton/) ·
[Report a bug](https://github.com/aliacollins/spenton-community/issues)

## Start with Docker

1. Install [Docker with Compose](https://docs.docker.com/get-started/get-docker/).
2. Download and extract **SpentOn-0.4.0-rc.3.zip** from the [release](https://github.com/aliacollins/spenton-community/releases/tag/v0.4.0-rc.3). Open a terminal in the extracted folder.
3. Run:

```sh
docker compose -f self-hosted/compose.yaml up -d --build
```

Open **http://localhost:8080**, choose a username and password, and create your
first budget. The initial build takes a few minutes. No email address, email
service, domain, separate Node.js installation or Cloud account is required.

Docker stores your budgets, accounts, private settings and daily backups in
persistent volumes. The default installation is accessible only from the
computer running Docker. See [SETUP.md](SETUP.md) for updates and password recovery.

Prefer Git? Clone the release and run the same Docker command:

```sh
git clone --branch v0.4.0-rc.3 --depth 1 https://github.com/aliacollins/spenton-community.git
cd spenton-community
```

## Budgeting for real life

| When life happens | What SpentOn helps you do |
| --- | --- |
| Pay arrives on different dates | Assign money you already have. Future income stays outside your spendable balance. |
| A bill is due later | Let category balances carry forward and set savings goals with an amount and date. |
| You buy something on a credit card | Track category spending and cash reserved for repayment separately. Paying the card does not count as spending again. |
| A purchase is refunded | Link the refund to the original purchase and correct the category's spending. |
| Friends share a bill | Review shares, balances and repayments with people on the same installation. |
| Subscriptions add up | Track recurring costs and upcoming dates; record the payment when it happens. |
| A bank balance differs | Review cleared entries and make an explicit reconciliation adjustment with a reason. |

Manual accounts, reviewed CSV imports, split purchases, reports and budget
exports are included. Both hosting options use the same budgeting rules and
three-budget limit. SpentOn does not connect to banks or move money.

## Free self-hosting or managed Cloud

| | Self-hosted | SpentOn Cloud |
| --- | --- | --- |
| Software access | Free under AGPL-3.0-only | 40-day trial; $7.99/month or $79/year when checkout opens |
| Computer and storage | You provide and control them | Managed by SpentOn |
| Updates and backups | You operate them; Docker includes daily backups | Managed service |
| Account | Local username and password | Separate Cloud account |
| Availability | Downloadable web beta | Cloud beta; paid checkout pending verification |

Cloud has no permanent free hosted tier and no launch discounts. Monthly
payments renew until cancelled; annual access is one payment for a year with
no automatic renewal. Hosting costs you pay to another provider are separate
from the free self-hosted software.

## Common questions

**Is SpentOn open source?** Yes. The web app, server, shared budgeting engine
and included native source use AGPL-3.0-only. You can inspect, modify and
redistribute the covered code under that license. Branding has separate
permissions in [LICENSE_SCOPE.md](LICENSE_SCOPE.md).

**Do I need email to self-host?** No. The standard Docker setup uses a local
username and password. The operator can recover a forgotten password locally.

**Where is my financial data stored?** On the server you use. The standard
Docker installation stores it on your computer in SQLite and Docker volumes.
Backups remain on that computer unless you copy them elsewhere.

**Is it end-to-end encrypted?** No. The app's server can read budget data.
SQLite documents and backup contents are not encrypted by SpentOn. Protect
the host and backups with access controls and disk encryption. Official Cloud
uses HTTPS; the default local setup uses HTTP restricted to your own computer.

**Can I use it on my phone?** The web interface supports phone screens, but
the default localhost installation is reachable only from its host computer.
The official iPhone app is coming soon. Native development source is included;
this release contains no App Store, TestFlight or signed mobile download.

**Can I share a bill with someone on another server?** Sharing requires accounts
on the same installation. Cloud and self-hosted accounts are separate.

**Can I take my data with me?** Yes. Export your budget from the app. Keep a
protected copy of your Docker volumes and backups before upgrades.

## Community and contributions

Use [GitHub Issues](https://github.com/aliacollins/spenton-community/issues) for
reproducible bugs and focused proposals, and [r/Spenton](https://www.reddit.com/r/Spenton/)
for setup questions and budgeting discussions. Read the
[community guidelines](CODE_OF_CONDUCT.md) and [contribution guide](CONTRIBUTING.md).
Never post real receipts, financial records, passwords or API keys.

Report vulnerabilities privately through [SECURITY.md](SECURITY.md).

## License and source

Product code: [GNU AGPL version 3 only](LICENSE).
Assets and contribution rights: [license scope](LICENSE_SCOPE.md).
Dependencies and fonts: [third-party notices](THIRD_PARTY_NOTICES.txt).

This repository contains the public product source, build instructions and
release downloads. Official Cloud billing and business administration are
separate and are not needed to run this distribution. Each release archive
includes a file-hash manifest and downloadable SHA-256 checksums.
