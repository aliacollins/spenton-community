// Public editorial content only. Never add account, invitation or API routes.
export const siteOrigin = 'https://spenton.dev';
export const publicContentSignal = 'ai-train=no, search=yes, ai-input=yes';
export const accountParameters = ['account-action', 'auth', 'share-invite', 'group-invite'];
export const marketingPages = [
  { path: '/learn/self-hosting/', source: 'learn/self-hosting/index.html', title: 'Self-host SpentOn: installation and setup guide | SpentOn', updated: '2026-09-14' },
  { path: '/', source: 'landing/index.html', title: 'SpentOn | Comprehensive open-source envelope budgeting', updated: '2026-09-14' },
  { path: '/learn/', source: 'learn/index.html', title: 'Budgeting guides and examples | SpentOn', updated: '2026-09-14' },
  { path: '/learn/try/', source: 'learn/try/index.html', title: 'Try shared expenses with example money | SpentOn', updated: '2026-09-14' },
  { path: '/learn/shared-expenses/', source: 'learn/shared-expenses/index.html', title: 'How to budget for shared expenses and repayments | SpentOn', updated: '2026-09-14' },
  { path: '/learn/envelope-budgeting/', source: 'learn/envelope-budgeting/index.html', title: 'Envelope budgeting: plan the money you have | SpentOn', updated: '2026-09-14' },
  { path: '/learn/credit-card-payments/', source: 'learn/credit-card-payments/index.html', title: 'Credit-card payments in a budget: avoid counting twice | SpentOn', updated: '2026-09-14' },
];
export const publicPageAliases = Object.fromEntries(marketingPages.flatMap(page => (
  page.path === '/'
    ? ['/', '/landing', '/landing/', '/landing/index.html']
    : [page.path, page.path.slice(0, -1), '/' + page.source]
).map(path => [path, page.path])));

export function isIndexablePage(url) {
  return url.hostname === 'spenton.dev' && Object.hasOwn(publicPageAliases, url.pathname)
    && !accountParameters.some(key => url.searchParams.has(key));
}
