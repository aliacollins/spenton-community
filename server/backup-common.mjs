import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, mkdir, lstat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

export const DAY = 86_400_000;
export const IST_OFFSET = 330 * 60_000;
export const BACKUP_HOUR = 3;
export const MAX_SNAPSHOT_BYTES = 512 * 1024 * 1024;
export const MAX_COMPRESSED_BYTES = 256 * 1024 * 1024;

// The most recent 03:00 Asia/Kolkata boundary. IST has no daylight-saving shift.
export function backupSlot(now = Date.now()) {
  const local = new Date(now + IST_OFFSET);
  let due = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), BACKUP_HOUR) - IST_OFFSET;
  if (now < due) due -= DAY;
  return { day: new Date(due + IST_OFFSET).toISOString().slice(0, 10), due };
}

export function validDay(day) {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
}

export function retainedDays(days) {
  const sorted = [...new Set(days)].filter(validDay).sort().reverse();
  const keep = new Set(sorted.slice(0, 7));
  const weeks = new Set();
  for (const day of sorted) {
    const date = new Date(day);
    // One latest successful snapshot per Sunday–Saturday week, including this week.
    const week = new Date(date.getTime() - date.getUTCDay() * DAY).toISOString().slice(0, 10);
    if (!weeks.has(week) && weeks.size < 4) { weeks.add(week); keep.add(day); }
  }
  return keep;
}

export function validateErasure(item) {
  if (!item || typeof item.userId !== 'string' || !/^[0-9a-f-]{36}$/.test(item.userId) ||
      !Number.isSafeInteger(item.deletedAt) || item.deletedAt <= 0) throw new Error('Invalid deletion record.');
  return { userId: item.userId, deletedAt: item.deletedAt };
}

export async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Backup directory must be a real directory.');
}

export async function durableWrite(path, data, flag = 'wx') {
  const handle = await open(path, flag, 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
}

export async function syncDirectory(path) {
  if (process.platform === 'win32') return; // Directory fsync is not supported on Windows.
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export function verifySnapshot(path) {
  const db = new DatabaseSync(path, { readOnly: true, timeout: 5000 });
  try {
    if (db.prepare('PRAGMA integrity_check').all().some(row => row.integrity_check !== 'ok') ||
        db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Snapshot integrity check failed.');
    for (const table of ['users', 'budgets', 'auth_users', 'account_erasures']) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error('Not a SpentOn database.');
    }
  } finally { db.close(); }
}
