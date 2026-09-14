import { DatabaseSync } from 'node:sqlite';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, copyFile, rm } from 'node:fs/promises';
import { join, resolve, parse } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { sha256File, verifySnapshot, validateErasure, MAX_SNAPSHOT_BYTES } from './backup-common.mjs';
import { createErasureService } from './account-data.mjs';

/** Restores into a NEW, isolated directory only. Never starts a listener or promotes the result. */
export async function restoreBackup({ backupDirectory, latestLedger, outputDirectory, confirmedIsolated = false } = {}) {
  if (!confirmedIsolated || !backupDirectory || !latestLedger || !outputDirectory) throw new Error('An isolated restore destination and current deletion ledger are required.');
  const target = resolve(outputDirectory);
  if (target === parse(target).root || /^\/data(?:\/|$)/.test(target) || target === resolve(backupDirectory)) throw new Error('Unsafe restore destination.');
  const manifest = JSON.parse(await readFile(join(backupDirectory, 'manifest.json'), 'utf8'));
  if (manifest.format !== 'spenton-sqlite-backup' || manifest.version !== 1 || !/^[a-f0-9]{64}$/.test(manifest.sha256 ?? '') ||
      !/^[a-f0-9]{64}$/.test(manifest.compressedSha256 ?? '') || !Number.isSafeInteger(manifest.bytes) || manifest.bytes > MAX_SNAPSHOT_BYTES) throw new Error('Invalid backup manifest.');
  const compressed = join(backupDirectory, 'database.sqlite.gz');
  if (await sha256File(compressed) !== manifest.compressedSha256) throw new Error('Compressed backup checksum mismatch.');
  const ledger = await readFile(latestLedger, 'utf8');
  for (const line of ledger.split('\n').filter(Boolean)) validateErasure(JSON.parse(line));
  // Exclusive directory creation refuses an existing restore or live database location.
  await mkdir(target, { mode: 0o700 });
  let complete = false;
  try {
    const dbPath = join(target, 'spenton.sqlite');
    let bytes = 0;
    const limit = new Transform({ transform(chunk, _, done) { bytes += chunk.length; done(bytes > MAX_SNAPSHOT_BYTES ? new Error('Restore exceeds size limit.') : null, chunk); } });
    await pipeline(createReadStream(compressed), createGunzip(), limit, createWriteStream(dbPath, { flags: 'wx', mode: 0o600 }));
    if (bytes !== manifest.bytes || await sha256File(dbPath) !== manifest.sha256) throw new Error('Restored backup checksum mismatch.');
    verifySnapshot(dbPath);
    await copyFile(latestLedger, dbPath + '.erasures.jsonl');
    const db = new DatabaseSync(dbPath);
    try {
      db.exec('PRAGMA foreign_keys=ON;');
      // Never let a snapshot resurrect sessions or previously consumed action challenges.
      db.exec('BEGIN IMMEDIATE');
      for (const table of ['auth_sessions', 'sessions', 'oauth_flows', 'auth_verifications', 'account_links', 'admin_stepups', 'admin_passkey_challenges', 'admin_passkey_stepups']) {
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) db.exec('DELETE FROM ' + table);
      }
      db.exec('COMMIT');
      createErasureService(db, dbPath).replay();
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } finally { db.close(); }
    verifySnapshot(dbPath);
    complete = true;
    return { dbPath, sourceCommit: manifest.sourceCommit, appVersion: manifest.appVersion, day: manifest.day,
      integrityVerified: true, sessionsRevoked: true, latestErasuresReplayed: true };
  } finally {
    // Only the directory exclusively created above can be removed by this function.
    if (!complete) await rm(target, { recursive: true, force: true });
  }
}
