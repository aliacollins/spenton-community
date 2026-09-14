# Run SpentOn on your computer

Download and extract the [latest beta release](https://github.com/aliacollins/spenton-community/releases).
With Docker and Compose installed, open a terminal in the extracted folder:

```sh
docker compose -f self-hosted/compose.yaml up -d --build
```

Open **http://localhost:8080** and choose a username and password. No email
service is needed. The first build downloads dependencies and can take a few
minutes. Keep Docker running while you use the app.

## Stop and start

```sh
docker compose -f self-hosted/compose.yaml stop
docker compose -f self-hosted/compose.yaml start
```

## Update without losing your budgets

Keep a protected copy of your data, settings and backup volumes. Download the
next release, read its release notes, and run the installation command from
that release's folder. Compose uses the same `spenton` project and named volumes.
Close the app during the update and confirm your budgets afterward.

Never use `docker compose down -v` for an update: `-v` deletes the volumes.
A code rollback does not reverse database changes. Preserve save-operation
records and the deletion ledger with backups.

## Password recovery

Change your password in **Account & privacy**. If you forget it, run:

```sh
docker compose -f self-hosted/compose.yaml exec app node self-hosted/reset-password.mjs
```

Enter the username and new password when prompted. Password entry is hidden.
Previous sessions are signed out; budget records are preserved.

## Storage and access

The `spenton_data`, `spenton_settings` and `spenton_backups` Docker volumes hold
the database, private settings and daily backups. Keep them private. Backups on
the same computer cannot survive its loss; retain a protected off-device copy.
You can also export individual budgets in the app.

The default port is bound to **127.0.0.1:8080**. This setup is for the computer
running Docker. Do not expose its HTTP port directly to a network. Accounts
belong to this installation; sharing requires both people to use this server.
Existing installations configured with email accounts should retain their
configuration; accounts are not automatically converted to local usernames.

For help, ask in [r/Spenton](https://www.reddit.com/r/Spenton/). Include your
release, operating system and a description of the problem using fictional
data. Remove personal details and secrets before sharing logs.
