import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export class NativeAuthError extends Error {
  constructor(status = 400, code = 'INVALID_NATIVE_FLOW', message = 'This sign-in has expired. Start again in SpentOn.') { super(message); Object.assign(this, { status, code }); }
}
const token = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('base64url');
const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

// Ephemeral handoff only. No session cookie or verifier enters a redirect URL,
// database, log or native preferences. A restart simply expires open sign-ins.
export function createNativeAuth({ now = Date.now, capacity = 256 } = {}) {
  const flows = new Map(), codes = new Map();
  const prune = () => {
    for (const [id, flow] of flows) if (flow.expires <= now()) flows.delete(id);
    for (const [id, code] of codes) if (code.expires <= now()) codes.delete(id);
  };
  return {
    prune,
    begin(provider, challenge, state) {
      prune();
      if (!['apple', 'google', 'microsoft'].includes(provider) || !validToken(challenge) || !validToken(state)) throw new NativeAuthError();
      if (flows.size + codes.size >= capacity) throw new NativeAuthError(429, 'RATE_LIMITED', 'Sign-in is busy. Try again shortly.');
      const ticket = token(), popup = randomUUID();
      flows.set(popup, { provider, challenge, state, ticket: hash(ticket), started: false, expires: now() + 300000 });
      return { ticket, popup };
    },
    start(ticket) {
      prune();
      if (!validToken(ticket)) throw new NativeAuthError();
      for (const [popup, flow] of flows) if (!flow.started && flow.ticket === hash(ticket)) {
        flow.started = true;
        return { popup, provider: flow.provider };
      }
      throw new NativeAuthError();
    },
    finish(popup, sessionCookies) {
      prune();
      const flow = flows.get(popup);
      if (!flow?.started) return null;
      flows.delete(popup);
      const callback = new URL('spenton://auth');
      callback.searchParams.set('state', flow.state);
      if (sessionCookies?.length) {
        const code = token();
        codes.set(hash(code), { challenge: flow.challenge, cookies: sessionCookies, expires: now() + 60000 });
        callback.searchParams.set('code', code);
      } else callback.searchParams.set('error', 'sign_in_failed');
      return callback.href;
    },
    exchange(code, verifier) {
      prune();
      if (!validToken(code) || typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new NativeAuthError();
      const record = codes.get(hash(code));
      if (!record || !timingSafeEqual(Buffer.from(record.challenge), Buffer.from(hash(verifier)))) throw new NativeAuthError();
      codes.delete(hash(code));
      return record.cookies;
    },
    close() { flows.clear(); codes.clear(); },
  };
}
