# SpentOn auth.md

## Audience and supported access

This document is for agents discovering SpentOn's public beta service and assistants helping a person use their own account. Public pages, this document, the API description, and GET /api/health require no credentials. Private budgets always require an authenticated account session and ownership checks.

SpentOn currently supports human account registration and browser session authentication. It does not provide autonomous agent registration, API keys, bearer tokens, OAuth client registration, ID-JAG, anonymous credentials, or delegated agent scopes. Google and Microsoft are sign-in providers, not an authorization server operated by SpentOn. No OAuth resource or authorization-server metadata is advertised.

## Registration and provisioning endpoints

- Account registration: POST https://spenton.dev/api/auth/register with Content-Type: application/json and an email/password JSON body. This creates a human account and can send verification email. Registration may be closed by the operator. Use the [sign-up form](https://spenton.dev/app) only at the person's explicit request.
- Password sign-in: POST https://spenton.dev/api/auth/login with email/password JSON. Email verification is required when configured; check GET https://spenton.dev/api/auth/email-status for availability. Complete verification through the emailed link before sign-in.
- Supported social methods: GET https://spenton.dev/api/auth/providers lists configured providers. Start a person-approved sign-in using the buttons in the browser; the browser manages the popup, state and callback flow.
- Provisioning for unattended agents: not supported. There is no POST /agent/auth endpoint. Do not create accounts or send verification emails during discovery or passive scanning.

## Credential use and revocation

After successful sign-in the service sets an HttpOnly, Secure, SameSite=Strict session cookie on HTTPS, scoped to /api (production name: __Secure-spenton.session_token). Let the browser manage it. Do not copy cookies or passwords into an agent prompt, log, or discovery request. Sessions normally expire after seven days; they are not bearer credentials. API writes require the actual site's Origin header and application/json where a body is used. Never manufacture a browser Origin to bypass that boundary.

GET https://spenton.dev/api/auth/me returns the signed-in user; GET https://spenton.dev/api/budgets lists only that account's budgets. Unauthenticated private requests return 401. POST https://spenton.dev/api/auth/logout revokes the current session. Password reset and confirmed account deletion revoke sessions as described in the [privacy notice](https://spenton.dev/privacy).

The supported agent workflow is public discovery followed by handing sign-in and account actions to the person in their browser. This document grants no permission to access or change a person's budget. [API documentation](https://spenton.dev/api-docs.md) · [OpenAPI description](https://spenton.dev/openapi.json).
