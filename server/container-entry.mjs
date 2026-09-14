import { chownSync, chmodSync, existsSync, lstatSync, mkdirSync } from 'node:fs';

// The mounted data volume is initially owned by root. Prepare only this service's
// fixed paths, then drop privileges before importing application code or listening.
process.umask(0o077);
if (process.getuid?.() === 0) {
  if (process.env.SPENTON_DB_PATH !== '/data/spenton.sqlite') throw new Error('Container database must use the configured data volume.');
  mkdirSync('/data', { recursive: true, mode: 0o700 });
  for (const path of ['/data', '/data/spenton.sqlite', '/data/spenton.sqlite-wal', '/data/spenton.sqlite-shm', '/data/spenton.sqlite.erasures.jsonl']) {
    if (!existsSync(path)) continue;
    if (lstatSync(path).isSymbolicLink()) throw new Error('Database paths must not be symbolic links.');
    chownSync(path, 1000, 1000);
    chmodSync(path, path === '/data' ? 0o700 : 0o600);
  }
  process.setgroups([]);
  process.setgid(1000);
  process.setuid(1000);
}
await import('./index.mjs');
