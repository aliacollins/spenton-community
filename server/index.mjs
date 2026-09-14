import { isAbsolute, resolve } from 'node:path';
import { createBudgetServer } from './api.mjs';
import { createResendEmailOptions } from './resend-transport.mjs';
import { createBackupClient } from './backup-client.mjs';
import { readFileSync } from 'node:fs';

// Bound provider requests, including response-body reads, so a stalled OAuth
// endpoint cannot hold the single-writer request queue indefinitely.
const nativeFetch=globalThis.fetch;
globalThis.fetch=(input,init={})=>nativeFetch(input,{...init,signal:AbortSignal.any([AbortSignal.timeout(15000),...(input instanceof Request?[input.signal]:[]),...(init.signal?[init.signal]:[])])});

{
  let app, backups;
  try {
    const host = process.env.SPENTON_HOST || '127.0.0.1';
    const port = Number(process.env.SPENTON_PORT || 8787);
    const secureCookies = process.env.SPENTON_SECURE_COOKIES === '1';
    const production = process.env.NODE_ENV === 'production';
    const localHttp=process.env.SPENTON_LOCAL_HTTP==='1'&&process.env.SPENTON_DEPLOYMENT_MODE==='self-hosted'&&process.env.SPENTON_LOCAL_ACCOUNTS==='1';
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
    if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !secureCookies && !localHttp) throw new Error('Non-loopback listeners require secure cookies.');
    const allowedOrigins = (process.env.SPENTON_ALLOWED_ORIGINS || 'http://127.0.0.1:5417').split(',').map(x => x.trim());
    if(localHttp&&(!process.env.SPENTON_DB_PATH||!isAbsolute(process.env.SPENTON_DB_PATH)||!process.env.SPENTON_ALLOWED_ORIGINS||secureCookies||allowedOrigins.some(value=>{const u=new URL(value);return u.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.origin!==value;})))throw new Error('Local HTTP requires exact loopback origins.');
    if (production && !localHttp && (!secureCookies || !process.env.SPENTON_ALLOWED_ORIGINS || allowedOrigins.some(origin => !origin.startsWith('https://')) || !process.env.SPENTON_DB_PATH || !isAbsolute(process.env.SPENTON_DB_PATH))) throw new Error('Production requires HTTPS origins, secure cookies, and an absolute persistent database path.');
    if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !localHttp && allowedOrigins.some(origin => !origin.startsWith('https://'))) throw new Error('Non-loopback listeners require HTTPS origins.');
    const allowRegistration = production ? process.env.SPENTON_ALLOW_REGISTRATION === '1' : process.env.SPENTON_ALLOW_REGISTRATION !== '0';
    const adminAllowedIps = process.env.SPENTON_ADMIN_ALLOWED_IPS ? process.env.SPENTON_ADMIN_ALLOWED_IPS.split(',').map(x => x.trim()) : production ? [] : ['127.0.0.1', '::1'];
    const trustedProxyIps = process.env.SPENTON_TRUSTED_PROXY_IPS ? process.env.SPENTON_TRUSTED_PROXY_IPS.split(',').map(x => x.trim()) : [];
    const adminDeviceSerials = process.env.SPENTON_ADMIN_DEVICE_SERIALS ? process.env.SPENTON_ADMIN_DEVICE_SERIALS.split(',').map(x => x.trim()) : [];
    const dbPath = resolve(process.env.SPENTON_DB_PATH || 'server/data/spenton.sqlite');
    if (process.env.SPENTON_BACKUP_URL || process.env.SPENTON_BACKUP_TOKEN) {
      backups = createBackupClient({ url: process.env.SPENTON_BACKUP_URL, token: process.env.SPENTON_BACKUP_TOKEN, dbPath,
        sourceCommit: process.env.SPENTON_DEPLOYMENT_MODE==='self-hosted'?process.env.SPENTON_SOURCE_COMMIT:process.env.RAILWAY_GIT_COMMIT_SHA,
        privateServiceHost:process.env.SPENTON_DEPLOYMENT_MODE==='self-hosted'?'backups':undefined,
        appVersion: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version });
    }
    app = createBudgetServer({ dbPath, deployment:process.env.SPENTON_DEPLOYMENT_MODE || 'cloud', staticDirectory:process.env.SPENTON_STATIC_DIRECTORY, localAccounts:process.env.SPENTON_LOCAL_ACCOUNTS==='1', allowedOrigins, secureCookies, allowRegistration, emailOptions:createResendEmailOptions(), adminAllowedIps, trustedProxyIps, adminAccessMode: process.env.SPENTON_ADMIN_ACCESS_MODE || 'private-gateway', adminOwnerEmail: process.env.SPENTON_ADMIN_OWNER_EMAIL || '', adminPasskeyOrigin: process.env.SPENTON_ADMIN_PASSKEY_ORIGIN || '', adminPasskeyRpId: process.env.SPENTON_ADMIN_PASSKEY_RP_ID || '', requireAdminDevice: production || process.env.SPENTON_REQUIRE_ADMIN_DEVICE === '1', adminDeviceSerials, archiveErasure: backups?.archiveErasure });
    const address = await app.listen(port, host);
    console.log(`Spenton API listening on ${address.address}:${address.port}.`);
    backups?.start();
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await backups?.close(); await app.close(); process.exit(0); });
  } catch {
    await backups?.close().catch(() => {});
    if (app) await app.close().catch(() => {});
    console.error('The API could not start. Check Node version, server settings, port availability, and database permissions.');
    process.exitCode = 1;
  }
}
