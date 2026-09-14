import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';

export function deploymentMode(value = 'cloud') {
  if (!['cloud', 'self-hosted'].includes(value)) throw new Error('Use cloud or self-hosted as the deployment mode.');
  return value;
}

export function serverCapabilities(db, mode) {
  db.exec('CREATE TABLE IF NOT EXISTS instance_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;');
  db.prepare("INSERT OR IGNORE INTO instance_settings VALUES('instance_id',?)").run(randomUUID());
  return {
    service: 'spenton', version: 1,
    appVersion: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version,
    instanceId: db.prepare("SELECT value FROM instance_settings WHERE key='instance_id'").get().value,
    deployment: mode,
    capabilities: {
      operationStatus: 1, budgetFormats: [1, 2, 3], subscriptions: 1,
      sharing: 'same-server', groups: 1, crossServerSharing: false,
      cloudSubscriptionRequired: mode === 'cloud',
    },
  };
}
