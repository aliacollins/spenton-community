import { DatabaseSync, backup } from 'node:sqlite';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { backupSlot, validateErasure, sha256File, verifySnapshot, MAX_SNAPSHOT_BYTES } from './backup-common.mjs';

// Capture before index.mjs installs the short timeout for interactive API requests.
const serviceFetch = globalThis.fetch;

export function createBackupClient({ url, token, dbPath, sourceCommit, appVersion, now = Date.now, fetchImpl = serviceFetch,
  report = event => console.log(JSON.stringify(event)), allowLoopback = false, privateServiceHost } = {}) {
  const destination = new URL(url);
  const privateHost = /^[a-z0-9][a-z0-9-]*\.railway\.internal$/.test(destination.hostname) ||
    (privateServiceHost === 'backups' && destination.hostname === privateServiceHost);
  const loopback = allowLoopback && ['127.0.0.1', '[::1]'].includes(destination.hostname);
  if ((!privateHost && !loopback) || destination.protocol !== 'http:' || destination.username || destination.password ||
      destination.pathname !== '/' || destination.search || destination.hash || !/^[a-f0-9]{64}$/.test(token ?? '') ||
      !/^[a-f0-9]{40}$/.test(sourceCommit ?? '') || typeof appVersion !== 'string' || !dbPath) throw new Error('Invalid private backup configuration.');
  const base = destination.origin;
  let interval, active = null, lastDay = null, retryAt = 0, stopped = false;
  async function request(path, options = {}, timeout = 15_000) {
    const response = await fetchImpl(base + path, { ...options, redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, ...options.headers }, signal: AbortSignal.timeout(timeout) });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Backup destination rejected the request.'); }
    const body = await response.json();
    return body;
  }
  async function archiveErasures(records) {
    const checked = records.map(validateErasure);
    for (let offset = 0; offset < checked.length; offset += 500) {
      const result = await request('/v1/erasures', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(checked.slice(offset, offset + 500)) });
      if (result.stored !== true) throw new Error('Deletion record was not acknowledged.');
    }
  }
  async function archiveErasure(userId) {
    const record = validateErasure({ userId, deletedAt: now() });
    await archiveErasures([record]);
  }
  async function syncErasureLedger() {
    let records = [];
    try { records = (await readFile(dbPath + '.erasures.jsonl', 'utf8')).split('\n').filter(Boolean).map(line => validateErasure(JSON.parse(line))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await archiveErasures(records);
  }
  async function run() {
    const slot = backupSlot(now());
    if (slot.day === lastDay) return { existing: true, day: slot.day };
    await syncErasureLedger();
    const status = await request('/v1/status');
    if (status.format !== 'spenton-backup-status' || !Array.isArray(status.days)) throw new Error('Invalid backup destination response.');
    if (status.days.includes(slot.day)) { lastDay = slot.day; return { existing: true, day: slot.day }; }
    const directory = await mkdtemp(join(tmpdir(), 'spenton-backup-'));
    try {
      const snapshot = join(directory, 'database.sqlite'), compressed = join(directory, 'database.sqlite.gz');
      const source = new DatabaseSync(dbPath, { readOnly: true, timeout: 5000 });
      try { await backup(source, snapshot); } finally { source.close(); }
      if ((await stat(snapshot)).size > MAX_SNAPSHOT_BYTES) throw new Error('Database exceeds configured backup capacity.');
      verifySnapshot(snapshot);
      await pipeline(createReadStream(snapshot), createGzip(), createWriteStream(compressed, { flags: 'wx', mode: 0o600 }));
      const digest = await sha256File(compressed), bytes = (await stat(compressed)).size;
      // Include any newer write-ahead erasures before this snapshot becomes a restore point.
      await syncErasureLedger();
      const result = await request(`/v1/snapshots/${slot.day}`, { method: 'PUT', duplex: 'half', body: createReadStream(compressed), headers: {
        'Content-Type': 'application/gzip', 'Content-Length': String(bytes), 'X-Spenton-Sha256': digest,
        'X-Spenton-Commit': sourceCommit, 'X-Spenton-Version': appVersion,
      } }, 5 * 60_000);
      if (result.stored !== true || result.day !== slot.day) throw new Error('Backup was not acknowledged.');
      lastDay = slot.day;
      report({ event: 'database_backup_saved', day: slot.day, compressedBytes: bytes, sourceCommit });
      return result;
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  function tick() {
    if (active) return active;
    if (stopped || now() < retryAt) return Promise.resolve(null);
    active = run().catch(() => {
      retryAt = now() + 5 * 60_000;
      report({ event: 'database_backup_failed', day: backupSlot(now()).day, retryInMinutes: 5 });
      return null;
    }).finally(() => { active = null; });
    return active;
  }
  return { run, tick, archiveErasure, syncErasureLedger,
    start() { if (interval) return; stopped = false; interval = setInterval(() => void tick(), 60_000); interval.unref(); void tick(); },
    async close() { stopped = true; clearInterval(interval); interval = null; await active; },
  };
}
