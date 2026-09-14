import {createHash, createPrivateKey, randomUUID, sign} from 'node:crypto';
import {connect} from 'node:http2';

const digest = value => createHash('sha256').update(value).digest('hex');
const uuid = value => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
export class NotificationError extends Error { constructor(status, message) { super(message); this.status = status; this.code = 'NOTIFICATION_SETTINGS'; } }
const fail = (status, message) => { throw new NotificationError(status, message); };
const copy = {
  create: ['New share request', 'A shared expense is ready to review.'],
  accept: ['Share accepted', 'Your shared expense has been updated.'],
  decline: ['Share declined', 'Your shared expense has been updated.'],
  cancel: ['Share request cancelled', 'Your shared expense has been updated.'],
  repay: ['Repayment recorded', 'A repayment is ready for you to review. Confirm receipt only after receiving the money.'],
  receive: ['Money received', 'The person who paid recorded receiving money for your share. Review it in People.'],
  confirm: ['Repayment confirmed', 'Receipt of your repayment has been confirmed.'],
  dispute: ['Repayment needs review', 'The recipient could not confirm receipt of your repayment.'],
};

export function pushPayload(device, event) {
  const [title, body] = copy[event.kind];
  return {aps: {alert: {title, body}, sound: 'default', 'thread-id': 'shared-expenses', 'interruption-level': 'active'}, route: 'shared', expenseID: event.expense_id, account: digest(device.user_id)};
}

export function createAPNs(env = process.env) {
  const team = env.SPENTON_APNS_TEAM_ID, keyID = env.SPENTON_APNS_KEY_ID, pem = env.SPENTON_APNS_PRIVATE_KEY;
  if (!team || !keyID || !pem) return null;
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('APNs requires an ES256 signing key.');
  let token, issued = 0;
  return async function send(device, event) {
    const now = Math.floor(Date.now() / 1000);
    if (!token || now - issued >= 3000) {
      const data = [ {alg: 'ES256', kid: keyID}, {iss: team, iat: now} ].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
      token = data + '.' + sign('sha256', Buffer.from(data), {key, dsaEncoding: 'ieee-p1363'}).toString('base64url'); issued = now;
    }
    const payload = JSON.stringify(pushPayload(device, event));
    return new Promise(resolve => {
      const client = connect(device.environment === 'production' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com');
      let finished = false, status = 0;
      const done = value => { if (finished) return; finished = true; clearTimeout(timer); client.destroy(); resolve(value); };
      const timer = setTimeout(() => done(0), 10000);
      client.on('error', () => done(0));
      const request = client.request({':method': 'POST', ':path': '/3/device/' + device.token, authorization: 'bearer ' + token, 'apns-topic': 'dev.spenton.ios', 'apns-push-type': 'alert', 'apns-priority': '10', 'apns-expiration': String(Math.floor(event.expires_at / 1000)), 'apns-id': event.id, 'apns-collapse-id': event.collapse_id});
      request.on('response', headers => { status = Number(headers[':status']); });
      request.on('data', () => {}); request.on('end', () => done(status)); request.on('error', () => done(0)); request.end(payload);
    });
  };
}

// Device bindings expire with the authenticated session. The outbox is written
// in the same transaction as the share change, before its idempotency record.
export function createPushNotifications(db, {send = createAPNs(), now = Date.now} = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS notification_devices (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE, token TEXT NOT NULL UNIQUE, environment TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS notification_outbox (
    id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES notification_devices(id) ON DELETE CASCADE,
    expense_id TEXT NOT NULL REFERENCES shared_expenses(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, collapse_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
    next_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    UNIQUE(device_id, collapse_id)
  ) STRICT;`);
  function prune() {
    db.prepare('DELETE FROM notification_devices WHERE session_id NOT IN (SELECT id FROM auth_sessions WHERE expiresAt>?)').run(new Date(now()).toISOString());
    db.prepare('DELETE FROM notification_outbox WHERE expires_at<=?').run(now());
  }
  function register(userID, sessionID, body) {
    if (!uuid(body.installationID) || typeof body.enabled !== 'boolean') fail(400, 'Choose notification settings for this iPhone.');
    prune();
    const id = body.installationID;
    // Rebinding another account needs the APNs token; a guessed installation ID
    // cannot remove a different account's delivery binding.
    if (!body.enabled) {
      db.prepare('DELETE FROM notification_devices WHERE id=? AND user_id=?').run(id, userID); return {enabled: false};
    }
    if (!send) fail(503, 'Shared-expense notifications are not available yet. Bill reminders still work on this iPhone.');
    if (!/^[a-f0-9]{64,512}$/i.test(body.token ?? '') || !['sandbox', 'production'].includes(body.environment)) fail(400, 'Reopen notification settings and try again.');
    const token = body.token.toLowerCase();
    const previous = db.prepare('SELECT * FROM notification_devices WHERE id=?').get(id);
    if (previous && previous.user_id !== userID && previous.token !== token) fail(409, 'Reopen the app before enabling notifications.');
    // Delete to cascade old-account queued events, including on token rotation.
    if (!previous || previous.user_id !== userID || previous.session_id !== sessionID || previous.token !== token || previous.environment !== body.environment) {
      db.prepare('DELETE FROM notification_devices WHERE id=? OR token=?').run(id, token);
      if (db.prepare('SELECT count(*) n FROM notification_devices WHERE user_id=?').get(userID).n >= 10) fail(409, 'Turn off notifications on another device first.');
      db.prepare('INSERT INTO notification_devices VALUES(?,?,?,?,?,?)').run(id, userID, sessionID, token, body.environment, now());
    }
    return {enabled: true};
  }
  function enqueue(actor, request, response) {
    if (!send || !copy[request.action]) return;
    const expense = db.prepare('SELECT * FROM shared_expenses WHERE id=?').get(response.expense.id);
    const shares = db.prepare('SELECT * FROM expense_shares WHERE expense_id=?').all(expense.id);
    let selected = shares;
    if (request.shareId) selected = shares.filter(s => s.id === request.shareId);
    if (request.settlementId) selected = shares.filter(s => s.id === db.prepare('SELECT share_id FROM share_settlements WHERE id=?').get(request.settlementId)?.share_id);
    const recipients = new Set();
    for (const share of selected) {
      const userID = actor === expense.owner_id ? (share.recipient_id ?? db.prepare('SELECT id FROM auth_users WHERE lower(email)=? AND emailVerified=1').get(share.email)?.id) : expense.owner_id;
      if (userID && userID !== actor) recipients.add(userID);
    }
    for (const recipient of recipients) {
      for (const device of db.prepare('SELECT d.id FROM notification_devices d JOIN auth_sessions s ON s.id=d.session_id WHERE d.user_id=? AND s.expiresAt>?').all(recipient, new Date(now()).toISOString())) {
        // A later event for the same expense replaces an undelivered stale one.
        const collapseID = digest(expense.id);
        db.prepare('INSERT INTO notification_outbox VALUES(?,?,?,?,?,?,?,0) ON CONFLICT(device_id,collapse_id) DO UPDATE SET id=excluded.id,kind=excluded.kind,expires_at=excluded.expires_at,next_at=excluded.next_at,attempts=0').run(randomUUID(), device.id, expense.id, request.action, collapseID, now() + 86400000, now());
      }
    }
  }
  async function flush(withLock) {
    await withLock(prune);
    if (!send) return;
    for (let i = 0; i < 20; i++) {
      const job = await withLock(() => { prune(); return db.prepare('SELECT e.*,d.user_id,d.token,d.environment FROM notification_outbox e JOIN notification_devices d ON d.id=e.device_id WHERE e.next_at<=? ORDER BY e.next_at LIMIT 1').get(now()); });
      if (!job) return;
      let status; try { status = await send(job, job); } catch { status = 0; }
      await withLock(() => {
        if (status === 410) db.prepare('DELETE FROM notification_devices WHERE id=? AND token=?').run(job.device_id, job.token);
        if (status === 200 || (status >= 400 && status < 500 && status !== 429) || job.attempts >= 2) db.prepare('DELETE FROM notification_outbox WHERE id=?').run(job.id);
        else db.prepare('UPDATE notification_outbox SET attempts=attempts+1,next_at=? WHERE id=?').run(now() + (job.attempts ? 300000 : 30000), job.id);
      });
    }
  }
  return {available: Boolean(send), register, enqueue, flush, prune};
}
