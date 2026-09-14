import { parseArgs } from 'node:util';
import { restoreBackup } from '../server/backup-restore.mjs';

const { values } = parseArgs({ options: { backup: { type: 'string' }, ledger: { type: 'string' }, output: { type: 'string' }, 'confirm-isolated': { type: 'boolean' } } });
const result = await restoreBackup({ backupDirectory: values.backup, latestLedger: values.ledger, outputDirectory: values.output, confirmedIsolated: values['confirm-isolated'] });
console.log(JSON.stringify(result));
