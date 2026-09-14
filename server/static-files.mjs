import {readFile, realpath, stat} from 'node:fs/promises';
import {resolve, sep, extname} from 'node:path';

const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
  '.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.mp3':'audio/mpeg','.wav':'audio/wav','.txt':'text/plain; charset=utf-8'};
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";

/** The self-hosted app and API share one HTTPS origin. Only built assets are served. */
export function createStaticFiles(directory,{localAccounts=false}={}) {
  const root = resolve(directory);
  return async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, {Allow:'GET, HEAD'}); res.end(); return; }
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://static.invalid').pathname);
      if (path === '/robots.txt') {
        res.writeHead(200, {'Content-Type': types['.txt']}); res.end(req.method === 'HEAD' ? undefined : 'User-agent: *\nDisallow: /\n'); return;
      }
      if (path.includes('\\') || path.split('/').some(part => part.startsWith('.'))) throw new Error('Invalid path');
      if (['/', '/app', '/app/', '/privacy', '/terms', '/index.html', '/landing', '/landing/', '/landing/index.html'].includes(path)) path = '/index.html';
      if (path.endsWith('/')) path += 'index.html';
      const file = await realpath(resolve(root, '.' + path));
      if (!file.startsWith(await realpath(root) + sep) || !types[extname(file)]) throw new Error('Invalid asset');
      const info = await stat(file);
      if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error('Invalid asset');
      let body = await readFile(file);
      if (path === '/index.html') body = Buffer.from(body.toString('utf8').replace('</head>', '<meta name="spenton-deployment" content="self-hosted">'+(localAccounts?'<meta name="spenton-local-accounts" content="true">':'')+'</head>'));
      if (/^\/assets\/[^/]+-[A-Za-z0-9_-]+\.(js|css)$/.test(path)) res.setHeader('Cache-Control','public, max-age=31536000, immutable');
      res.writeHead(200, {'Content-Type':types[extname(file)], 'Content-Length':body.length});
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(404, {'Content-Type':types['.txt']}); res.end(req.method === 'HEAD' ? undefined : 'Not found.'); }
  };
}
