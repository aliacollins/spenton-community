import { createServer } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, rename, stat, statfs, open } from 'node:fs/promises';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { backupSlot, validDay, retainedDays, validateErasure, privateDirectory, durableWrite, syncDirectory,
  sha256File, verifySnapshot, MAX_COMPRESSED_BYTES, MAX_SNAPSHOT_BYTES } from './backup-common.mjs';

function limitBytes(limit) {
  let size = 0;
  return new Transform({ transform(chunk, _, done) { size += chunk.length; done(size > limit ? new Error('Backup exceeds size limit.') : null, chunk); } });
}

// A private, write-only backup destination. No HTTP route returns database contents.
export async function createBackupStore({ directory, token, now = Date.now, maxSnapshotBytes = MAX_SNAPSHOT_BYTES } = {}) {
  if (!directory || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Backup storage requires a directory and a 256-bit token.');
  await privateDirectory(directory);
  const snapshots = join(directory, 'snapshots');
  await privateDirectory(snapshots);
  const ledgerPath = join(directory, 'latest.erasures.jsonl');
  const erasures = new Map();
  try {
    for (const line of (await readFile(ledgerPath, 'utf8')).split('\n').filter(Boolean)) {
      const item = validateErasure(JSON.parse(line));
      erasures.set(item.userId, item.deletedAt);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await durableWrite(ledgerPath, '');
    await syncDirectory(directory);
  }
  // Unpublished partial uploads can never become restore points.
  for (const entry of await readdir(snapshots, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('.pending-')) await rm(join(snapshots, entry.name), { recursive: true });
  }
  let uploading = false, ledgerQueue = Promise.resolve();
  const days = async () => (await readdir(snapshots, { withFileTypes: true })).filter(e => e.isDirectory() && validDay(e.name)).map(e => e.name).sort();
  const respond = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const authorized = req => {
    const received = Buffer.from(req.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    return received.length === expected.length && timingSafeEqual(received, expected) && !req.headers.origin;
  };
  const server = createServer(async (req, res) => {
    let pending, ownsUpload = false;
    try {
      if (req.method === 'GET' && req.url === '/health') return respond(res, 200, { ok: true });
      if (!authorized(req)) { req.resume(); return respond(res, 401, { error: 'Unauthorized' }); }
      if (req.method === 'GET' && req.url === '/v1/status') {
        const available = await days();
        return respond(res, 200, { format: 'spenton-backup-status', days: available, latestDay: available.at(-1) ?? null,
          erasureCount: erasures.size, schedule: '03:00 Asia/Kolkata', daily: 7, weekly: 4 });
      }
      if (req.method === 'POST' && req.url === '/v1/erasures') {
        if (!/^application\/json(?:;|$)/.test(req.headers['content-type'] ?? '')) return respond(res, 415, { error: 'JSON required' });
        const chunks = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 128 * 1024) throw new Error('Deletion batch is too large.');
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!Array.isArray(body) || body.length > 500) throw new Error('Invalid deletion batch.');
        const records = body.map(validateErasure);
        const operation = ledgerQueue.then(async () => {
          const fresh = new Map();
          for (const record of records) if (!erasures.has(record.userId)) fresh.set(record.userId, record.deletedAt);
          if (fresh.size) {
            const data = [...fresh].map(([userId, deletedAt]) => JSON.stringify({ userId, deletedAt }) + '\n').join('');
            await durableWrite(ledgerPath, data, 'a');
            await syncDirectory(directory);
            for (const [id, timestamp] of fresh) erasures.set(id, timestamp);
          }
        });
        ledgerQueue = operation.catch(() => {});
        await operation;
        return respond(res, 200, { stored: true });
      }
      const match = /^\/v1\/snapshots\/(\d{4}-\d{2}-\d{2})$/.exec(req.url ?? '');
      if (req.method !== 'PUT' || !match || !validDay(match[1])) { req.resume(); return respond(res, 404, { error: 'Not found' }); }
      const day = match[1];
      if (day !== backupSlot(now()).day) { req.resume(); return respond(res, 409, { error: 'Snapshot is not for the current backup day' }); }
      if ((await days()).includes(day)) { req.resume(); return respond(res, 200, { stored: true, existing: true, day }); }
      if (uploading) { req.resume(); return respond(res, 409, { error: 'Backup already running' }); }
      const expectedHash = req.headers['x-spenton-sha256'];
      const sourceCommit = req.headers['x-spenton-commit'];
      const appVersion = req.headers['x-spenton-version'];
      if (req.headers['content-type'] !== 'application/gzip' || !/^[a-f0-9]{64}$/.test(expectedHash ?? '') ||
          !/^[a-f0-9]{40}$/.test(sourceCommit ?? '') || !/^[0-9][0-9A-Za-z.+-]{0,60}$/.test(appVersion ?? '')) {
        req.resume(); return respond(res, 400, { error: 'Invalid backup metadata' });
      }
      const length = Number(req.headers['content-length']);
      if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_COMPRESSED_BYTES) { req.resume(); return respond(res, 413, { error: 'Invalid backup size' }); }
      uploading = true;
      ownsUpload = true;
      const disk = await statfs(directory);
      if (disk.bavail * disk.bsize < length + maxSnapshotBytes + 64 * 1024 * 1024) { req.resume(); return respond(res, 507, { error: 'Insufficient backup storage' }); }
      pending = await mkdtemp(join(snapshots, '.pending-'));
      const compressed = join(pending, 'database.sqlite.gz'), raw = join(pending, 'verify.sqlite');
      await pipeline(req, limitBytes(MAX_COMPRESSED_BYTES), createWriteStream(compressed, { flags: 'wx', mode: 0o600 }));
      if ((await stat(compressed)).size !== length || await sha256File(compressed) !== expectedHash) throw new Error('Backup checksum mismatch.');
      await pipeline(createReadStream(compressed), createGunzip(), limitBytes(maxSnapshotBytes), createWriteStream(raw, { flags: 'wx', mode: 0o600 }));
      verifySnapshot(raw);
      const manifest = { format: 'spenton-sqlite-backup', version: 1, day, receivedAt: new Date(now()).toISOString(),
        sourceCommit, appVersion, bytes: (await stat(raw)).size, compressedBytes: length,
        sha256: await sha256File(raw), compressedSha256: expectedHash };
      await rm(raw);
      const handle = await open(compressed, 'r+');
      try { await handle.sync(); } finally { await handle.close(); }
      await durableWrite(join(pending, 'manifest.json'), JSON.stringify(manifest, null, 2));
      await syncDirectory(pending);
      await rename(pending, join(snapshots, day));
      pending = null;
      await syncDirectory(snapshots);
      // Prune only after a new, complete, checked snapshot is durably published.
      const all = await days(), keep = retainedDays(all);
      for (const old of all) if (!keep.has(old)) await rm(join(snapshots, old), { recursive: true });
      await syncDirectory(snapshots);
      return respond(res, 201, { stored: true, day, sha256: manifest.sha256 });
    } catch {
      if (pending) { await rm(pending, { recursive: true, force: true }).catch(() => {}); pending = null; }
      if (ownsUpload) { uploading = false; ownsUpload = false; }
      if (!res.destroyed && !res.writableEnded) respond(res, 500, { error: 'Backup could not be stored' });
    } finally {
      if (pending) await rm(pending, { recursive: true, force: true }).catch(() => {});
      if (ownsUpload) uploading = false;
    }
  });
  server.requestTimeout = 5 * 60_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5000;
  return { server, listen: (port = 8790, host = '::') => new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(server.address()); });
  }), close: async () => { await ledgerQueue; if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } };
}
