import { chmodSync, chownSync, lstatSync, mkdirSync } from 'node:fs';
import { createBackupStore } from './backup-store.mjs';

process.umask(0o077);
const directory = '/backups';
if (process.env.SPENTON_BACKUP_DIRECTORY && process.env.SPENTON_BACKUP_DIRECTORY !== directory) throw new Error('Unexpected backup volume mount.');
if (process.getuid?.() === 0) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink()) throw new Error('Backup volume must not be a symbolic link.');
  chownSync(directory, 1000, 1000); chmodSync(directory, 0o700);
  process.setgroups([]); process.setgid(1000); process.setuid(1000);
}
let store;
try {
  store = await createBackupStore({ directory, token: process.env.SPENTON_BACKUP_TOKEN });
  await store.listen(8790, '::');
  console.log('Private SpentOn backup storage ready.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await store.close(); process.exit(0); });
} catch {
  console.error('Backup storage could not start. Check the private volume and service configuration.');
  process.exitCode = 1;
}
