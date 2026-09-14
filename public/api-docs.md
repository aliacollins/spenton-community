# SpentOn API documentation

Base URL: https://spenton.dev/api

This is the beta web application's same-origin API. The OpenAPI description documents its public discovery endpoints and authenticated budget-list endpoint; it is not a promise of a complete third-party integration API.

## Public requests

- GET /health: service health, with ok, service and version fields.
- GET /auth/providers: available sign-in methods; availability depends on server configuration.
- GET /auth/email-status: email delivery availability and whether verification is required.

## Private requests

- GET /auth/me: the current authenticated user.
- GET /budgets: the current account's budget summaries.

Private operations use server-validated session cookies and derive account identity from the session. Unauthenticated requests return 401. Access never comes from an owner ID supplied by a client. API responses use Cache-Control: no-store. Budget amounts use integer minor currency units. Registration and sign-in are documented in [auth.md](https://spenton.dev/auth.md); unattended agent credentials are not supported.

This catalog does not enable public budget access. Automated discovery must not submit registration, reset, email, payment, deletion, or budget mutations. [OpenAPI description](https://spenton.dev/openapi.json) · [Privacy](https://spenton.dev/privacy).
