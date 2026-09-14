import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TurndownService from 'turndown';
import { siteOrigin, marketingPages, publicPageAliases, publicContentSignal } from '../public-pages.mjs';

// This manifest is the source of truth for public discovery. Never render the app,
// fetch the API, or include request/session data in these build-time documents.
export const origin = siteOrigin;
const converter = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });
converter.remove(['script', 'style', 'svg', 'button', 'input']);
converter.addRule('tableRows', { filter: 'tr', replacement: (_, node) => '\n- ' + Array.from(node.children).map(cell => cell.textContent.trim()).join(': ') + '\n' });
const markdown = html => converter.turndown(html).replace(/\]\(\/(?!\/)/g, '](' + origin + '/') + '\n';
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
let privacy, terms;
try { const { default: Privacy } = await vite.ssrLoadModule('/src/PrivacyPage.tsx'); privacy = markdown(renderToStaticMarkup(createElement(Privacy))); const { default: Terms } = await vite.ssrLoadModule('/src/TermsPage.tsx'); terms = markdown(renderToStaticMarkup(createElement(Terms))); }
finally { await vite.close(); }
const landingHtml = await readFile('landing/index.html', 'utf8');
const landing = markdown(landingHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1]);
const auth = `# SpentOn auth.md

## Audience and supported access

This document is for agents discovering SpentOn's public beta service and assistants helping a person use their own account. Public pages, this document, the API description, and GET /api/health require no credentials. Private budgets always require an authenticated account session and ownership checks.

SpentOn currently supports human account registration and browser session authentication. It does not provide autonomous agent registration, API keys, bearer tokens, OAuth client registration, ID-JAG, anonymous credentials, or delegated agent scopes. Google and Microsoft are sign-in providers, not an authorization server operated by SpentOn. No OAuth resource or authorization-server metadata is advertised.

## Registration and provisioning endpoints

- Account registration: POST ${origin}/api/auth/register with Content-Type: application/json and an email/password JSON body. This creates a human account and can send verification email. Registration may be closed by the operator. Use the [sign-up form](${origin}/app) only at the person's explicit request.
- Password sign-in: POST ${origin}/api/auth/login with email/password JSON. Email verification is required when configured; check GET ${origin}/api/auth/email-status for availability. Complete verification through the emailed link before sign-in.
- Supported social methods: GET ${origin}/api/auth/providers lists configured providers. Start a person-approved sign-in using the buttons in the browser; the browser manages the popup, state and callback flow.
- Provisioning for unattended agents: not supported. There is no POST /agent/auth endpoint. Do not create accounts or send verification emails during discovery or passive scanning.

## Credential use and revocation

After successful sign-in the service sets an HttpOnly, Secure, SameSite=Strict session cookie on HTTPS, scoped to /api (production name: __Secure-spenton.session_token). Let the browser manage it. Do not copy cookies or passwords into an agent prompt, log, or discovery request. Sessions normally expire after seven days; they are not bearer credentials. API writes require the actual site's Origin header and application/json where a body is used. Never manufacture a browser Origin to bypass that boundary.

GET ${origin}/api/auth/me returns the signed-in user; GET ${origin}/api/budgets lists only that account's budgets. Unauthenticated private requests return 401. POST ${origin}/api/auth/logout revokes the current session. Password reset and confirmed account deletion revoke sessions as described in the [privacy notice](${origin}/privacy).

The supported agent workflow is public discovery followed by handing sign-in and account actions to the person in their browser. This document grants no permission to access or change a person's budget. [API documentation](${origin}/api-docs.md) · [OpenAPI description](${origin}/openapi.json).
`;
const apiDocs = `# SpentOn API documentation

Base URL: ${origin}/api

This is the beta web application's same-origin API. The OpenAPI description documents its public discovery endpoints and authenticated budget-list endpoint; it is not a promise of a complete third-party integration API.

## Public requests

- GET /health: service health, with ok, service and version fields.
- GET /auth/providers: available sign-in methods; availability depends on server configuration.
- GET /auth/email-status: email delivery availability and whether verification is required.

## Private requests

- GET /auth/me: the current authenticated user.
- GET /budgets: the current account's budget summaries.

Private operations use server-validated session cookies and derive account identity from the session. Unauthenticated requests return 401. Access never comes from an owner ID supplied by a client. API responses use Cache-Control: no-store. Budget amounts use integer minor currency units. Registration and sign-in are documented in [auth.md](${origin}/auth.md); unattended agent credentials are not supported.

This catalog does not enable public budget access. Automated discovery must not submit registration, reset, email, payment, deletion, or budget mutations. [OpenAPI description](${origin}/openapi.json) · [Privacy](${origin}/privacy).
`;
const home = `# SpentOn

SpentOn is a comprehensive envelope budgeting app with a free, open-source self-hosted beta. Plan spending, track subscriptions, manage credit-card cash and split bills. SpentOn Cloud is in beta. This URL is the account sign-in and private budgeting app. Its public Markdown representation contains no account or budget data.

[Explore SpentOn](${origin}/) · [Open the app and sign in](${origin}/app) · [Privacy](${origin}/privacy) · [Authentication](${origin}/auth.md) · [API documentation](${origin}/api-docs.md)

${landing}`;
const documents = { '/': landing, '/app': home, '/index.html': home, '/landing': landing, '/landing/': landing, '/landing/index.html': landing, '/privacy': privacy, '/privacy/': privacy, '/terms': terms, '/terms/': terms };
const guideDocuments = await Promise.all(marketingPages.filter(page => page.path !== '/').map(async page => {
  const html = await readFile(page.source, 'utf8');
  return [page.path, markdown(html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1])];
}));
const guides = Object.fromEntries(guideDocuments);
for (const [alias, canonical] of Object.entries(publicPageAliases)) {
  if (guides[canonical]) documents[alias] = guides[canonical];
}
// Only actual public marketing pages belong in the sitemap. App-shell routes
// and service discovery remain noindex, even though their public docs are readable.
const rules = 'Allow: /\nDisallow: /api/\nAllow: /api/health$\nAllow: /api/auth/providers$\nAllow: /api/auth/email-status$\nDisallow: /admin\nDisallow: /index.html\nDisallow: /*?\nContent-Signal: ' + publicContentSignal + '\n';
const blockedBots = ['GPTBot', 'Claude-Web', 'ClaudeBot', 'Google-Extended', 'Amazonbot', 'anthropic-ai', 'Bytespider', 'CCBot', 'Applebot-Extended'];
const searchBots = ['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot', 'Googlebot', 'Bingbot', 'Applebot'];
const answerBots = ['ChatGPT-User', 'Claude-User', 'Perplexity-User'];
const answerRules = 'Disallow: /\n' + Object.keys(publicPageAliases).map(path => `Allow: ${path}$\n`).join('')
  + 'Disallow: /*?\nContent-Signal: ' + publicContentSignal + '\n';
const robots = '# Public content only. Private API access additionally requires authentication.\nUser-agent: *\n' + rules + '\n'
  + searchBots.map(bot => 'User-agent: ' + bot + '\n' + rules).join('\n') + '\n'
  + answerBots.map(bot => 'User-agent: ' + bot + '\n' + answerRules).join('\n') + '\n'
  + blockedBots.map(bot => 'User-agent: ' + bot + '\nDisallow: /\nContent-Signal: ai-train=no, search=yes, ai-input=no\n').join('\n')
  + '\nSitemap: ' + origin + '/sitemap.xml\n';
const catalog = { linkset: [{ anchor: origin + '/api', 'service-desc': [{ href: origin + '/openapi.json', type: 'application/vnd.oai.openapi+json' }], 'service-doc': [{ href: origin + '/api-docs.md', type: 'text/markdown' }], status: [{ href: origin + '/api/health', type: 'application/json' }] }] };
const response = description => ({ description, content: { 'application/json': { schema: { type: 'object' } } } });
const get = (summary, authenticated = false) => ({ summary, security: authenticated ? [{ sessionCookie: [] }] : [], responses: { 200: response('Successful JSON response'), ...(authenticated ? { 401: response('Authentication required') } : {}) } });
const openapi = { openapi: '3.1.0', info: { title: 'SpentOn beta API', version: '1.0.0', description: 'Public service discovery and selected authenticated read endpoints. No autonomous agent provisioning or bearer authentication.' }, servers: [{ url: origin + '/api' }], externalDocs: { url: origin + '/api-docs.md' }, paths: { '/health': { get: get('Service health') }, '/auth/providers': { get: get('Configured browser sign-in providers') }, '/auth/email-status': { get: get('Email and verification availability') }, '/auth/me': { get: get('Current account', true) }, '/budgets': { get: get('Current account budget summaries', true) } }, components: { securitySchemes: { sessionCookie: { type: 'apiKey', in: 'cookie', name: '__Secure-spenton.session_token', description: 'HttpOnly browser session issued by human sign-in. Not an API key or bearer token. See /auth.md.' } } } };
await mkdir('public/.well-known', { recursive: true });
await mkdir('generated', { recursive: true });
for (const [path, content] of Object.entries({ 'public/robots.txt': robots, 'public/sitemap.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + marketingPages.map(page => '  <url><loc>' + origin + page.path + '</loc><lastmod>' + page.updated + '</lastmod></url>').join('\n') + '\n</urlset>\n', 'public/auth.md': auth, 'public/api-docs.md': apiDocs, 'public/openapi.json': JSON.stringify(openapi, null, 2) + '\n', 'public/.well-known/api-catalog': JSON.stringify(catalog, null, 2) + '\n', 'generated/public-markdown.mjs': 'export default ' + JSON.stringify(documents, null, 2) + ';\n', 'generated/public-markdown.json': JSON.stringify(documents, null, 2) + '\n' })) await writeFile(path, content);
console.log('Generated public discovery documents and Markdown from current landing/privacy content.');
