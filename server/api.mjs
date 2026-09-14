import {localAccountEmail,localUsername,prepareLocalAccounts,resetLocalPassword} from './local-accounts.mjs';
import {createPushNotifications, NotificationError} from './push-notifications.mjs';
import { createNativeAuth, NativeAuthError } from './native-auth.mjs';
import { createSharedExpenses, SharedExpenseError } from './shared-expenses.mjs';
import { createReceiptScans, ScanError, SCAN_BODY_LIMIT } from './receipt-scans.mjs';
import { createBudgetChanges } from './budget-changes.mjs';
import { createOnboardingService, OnboardingError } from './onboarding.mjs';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync,existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { isIP } from 'node:net';
import { validateBudget } from '../src/engine.ts';
import {applySubscriptionFlags,retainedSubscriptionFlags} from '../src/subscriptions.ts';

import { createMailer } from './mailer.mjs';
import { emailTemplate } from './email-templates.mjs';
import { createEmailPreferences } from './email-preferences.mjs';
import { exportAccountData, createErasureService } from './account-data.mjs';
import { createAuthentication, authHeaders, verifyCredential } from './auth.mjs';
import {createOperationStatus, OperationStatusError} from './operation-status.mjs';
import {deploymentMode, serverCapabilities} from './deployment-mode.mjs';
import {createStaticFiles} from './static-files.mjs';
import * as selfHostedServices from './self-hosted-services.mjs';
const cloudServices=existsSync(new URL('./cloud-services.mjs',import.meta.url))?await import('./cloud-services.mjs'):null;
const operationId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{16,128}$/.test(value);
const digest = token => createHash('sha256').update(token).digest('hex');
class ApiError extends Error {
  constructor(status, code, message, details = {}) { super(message); Object.assign(this, { status, code, details }); }
}
const fail = (status, code, message, details) => { throw new ApiError(status, code, message, details); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function normalizedIp(value) {
  if (typeof value !== 'string' || value.includes('%') || !isIP(value)) throw new Error('Use exact IP addresses without ports or ranges.');
  if (isIP(value) === 4) return value;
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
  return [high >>> 8, high & 255, low >>> 8, low & 255].join('.');
}

async function readRaw(req, maxBytes, mediaType='json') {
  if(req.cachedRaw){if(req.cachedRaw.length>maxBytes)fail(413,'TOO_LARGE','This request is too large.');return req.cachedRaw;}
  if (!(mediaType==='form'?/^application\/x-www-form-urlencoded(?:\s*;|$)/i:/^application\/json(?:\s*;|$)/i).test(req.headers['content-type'] ?? '')) fail(415, 'JSON_REQUIRED', 'Send an application/json request.');
  if (Number(req.headers['content-length']) > maxBytes) fail(413, 'TOO_LARGE', 'This request is too large.');
  const chunks = await new Promise((resolve, reject) => {
    let size = 0;
    const collected = [];
    const cleanup = () => { req.off('data', onData); req.off('end', onEnd); req.off('error', onError); req.off('aborted', onAbort); };
    const onError = () => { cleanup(); reject(new ApiError(400, 'INCOMPLETE_REQUEST', 'The request was interrupted.')); };
    const onAbort = onError;
    const onEnd = () => { cleanup(); resolve(collected); };
    const onData = chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        cleanup();
        req.resume();
        reject(new ApiError(413, 'TOO_LARGE', 'This request is too large.'));
      } else collected.push(chunk);
    };
    req.on('data', onData); req.on('end', onEnd); req.on('error', onError); req.on('aborted', onAbort);
  });
  return Buffer.concat(chunks);
}
async function readJson(req, maxBytes) {
  const raw = await readRaw(req, maxBytes);
  let body;
  try { body = JSON.parse(raw.toString('utf8'),(key,value)=>{if(['__proto__','prototype','constructor'].includes(key))throw new Error('Invalid object key.');return value;}); }
  catch { fail(400, 'INVALID_JSON', 'Send a valid JSON object.'); }
  if (!isObject(body)) fail(400, 'INVALID_JSON', 'Send a valid JSON object.');
  return body;
}

function credentials(body) {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fail(400, 'INVALID_EMAIL', 'Enter a valid email address.');
  if (typeof body.password !== 'string' || body.password.length < 12 || Buffer.byteLength(body.password) > 1024) fail(400, 'INVALID_PASSWORD', 'Use a password of at least 12 characters and no more than 1,024 bytes.');
  return { email, password: body.password };
}

function reviewedBudget(body) {
  if (body.reviewed !== true) fail(400, 'REVIEW_REQUIRED', 'Review this budget and explicitly confirm the upload first.');
  let budget;
  try { budget = validateBudget(body.budget); }
  catch { fail(400, 'INVALID_BUDGET', 'This budget could not be validated. Check it locally before uploading.'); }
  if (budget.demo !== false) fail(400, 'DEMO_NOT_ALLOWED', 'Start your own budget before enabling sync. Demo data cannot be uploaded.');
  return budget;
}

/** Creates an explicitly requested API instance. Merely importing this module starts nothing. */
export function createBudgetServer({ dbPath, deployment = 'cloud', localAccounts=false, staticDirectory, allowedOrigins = ['http://127.0.0.1:5417'], secureCookies = false, allowRegistration = true, sessionTtlMs = 7 * 86400000, maxBodyBytes = 8 * 1024 * 1024, authLimit = 30, accountAuthLimit = 10, authWindowMs = 15 * 60000, couponOptions = {}, billingOptions = {}, scanOptions = {}, pushOptions = {}, adminAllowedIps = process.env.NODE_ENV === 'production' ? [] : ['127.0.0.1', '::1'], trustedProxyIps = [], requireAdminDevice = process.env.NODE_ENV === 'production', adminDeviceSerials = [], adminAccessMode = 'private-gateway', adminOwnerEmail = '', adminPasskeyOrigin = '', adminPasskeyRpId = '', authSecret, socialEnv, emailOptions = {}, requireEmailVerification, archiveErasure } = {}) {
  const mode = deploymentMode(deployment);
  if(localAccounts&&mode!=='self-hosted')throw new Error('Local accounts are only available in self-hosting.');
  if(localAccounts&&(emailOptions.send||requireEmailVerification))throw new Error('Local accounts do not use email verification.');
  const services=mode==='cloud'?cloudServices:selfHostedServices;
  if(!services)throw new Error('Cloud operations are not included in this self-hosted distribution.');
  const {createCouponService,createBillingService,createOwnerOperations,createOwnerTestingService,createAccountResetService,createAdminPasskeyService}=services;
  if(staticDirectory&&mode!=='self-hosted')throw new Error('Built-in static hosting is for self-hosted installations.');
  const staticFiles=staticDirectory?createStaticFiles(staticDirectory,{localAccounts}):null;
  if (!dbPath) throw new Error('An explicit database path is required.');
  const origins = new Set(allowedOrigins.map(origin => {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('Allowed origins must be exact HTTP or HTTPS origins.');
    if (!secureCookies && !(parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname))) throw new Error('HTTPS origins require secure cookies.');
    return origin;
  }));
  if (!origins.size || !Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 1 || !Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1 || !Number.isSafeInteger(authLimit) || authLimit < 1 || !Number.isSafeInteger(accountAuthLimit) || accountAuthLimit < 1 || !Number.isSafeInteger(authWindowMs) || authWindowMs < 1) throw new Error('Invalid server limits.');
  if (!['private-gateway', 'passkey'].includes(adminAccessMode)) throw new Error('Invalid owner access mode.');
  if (typeof adminOwnerEmail !== 'string') throw new Error('Invalid owner email.');
  const ownerEmail = adminOwnerEmail.trim().toLowerCase();
  if (adminAccessMode !== 'private-gateway' && (!secureCookies || [...origins].some(origin => !origin.startsWith('https://')) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail))) throw new Error('Owner passkey access requires HTTPS, secure cookies and an exact owner email.');
  if (adminAccessMode === 'passkey' && (!origins.has(adminPasskeyOrigin) || !adminPasskeyOrigin.startsWith('https://'))) throw new Error('Passkey owner access requires one exact configured HTTPS origin.');
  if (adminAccessMode === 'passkey' && adminPasskeyRpId && !origins.has('https://' + adminPasskeyRpId)) throw new Error('Admin passkey RP ID must belong to an explicitly allowed HTTPS origin.');
  const adminIps = new Set(adminAllowedIps.map(normalizedIp));
  const trustedProxies = new Set(trustedProxyIps.map(normalizedIp));
  const deviceSerials = new Set(adminDeviceSerials.map(serial => {
    if (typeof serial !== 'string' || !/^[a-fA-F0-9]{1,64}$/.test(serial)) throw new Error('Device certificate serials must be hexadecimal without separators.');
    return serial.toUpperCase();
  }));
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath, { timeout: 5000 });
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, salt TEXT NOT NULL,
      password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, document TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0),
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS budgets_owner ON budgets(owner_id);
    CREATE TABLE IF NOT EXISTS budget_mutations (
      budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
      mutation_id TEXT NOT NULL, request_hash TEXT NOT NULL, response TEXT NOT NULL,
      revision INTEGER NOT NULL, PRIMARY KEY (budget_id, mutation_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS budget_creations (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mutation_id TEXT NOT NULL, request_hash TEXT NOT NULL,
      budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, mutation_id)
    ) STRICT;
  `);
  const operations = createOperationStatus(db);
  const capabilities = serverCapabilities(db, mode);
  try{prepareLocalAccounts(db,localAccounts);}catch(error){db.close();throw error;}
  capabilities.capabilities.localAccounts=localAccounts;
  const mailer=createMailer(emailOptions);
  // A mail configuration change must never turn mailbox ownership checks off.
  const verificationRequired=!localAccounts&&(process.env.NODE_ENV==='production'||(requireEmailVerification??mailer.available));
  if(verificationRequired&&!mailer.available){db.close();throw new Error('Email verification requires a configured email sender.');}
  let authentication;
  try{authentication=createAuthentication(db,{dbPath,origins:[...origins],secureCookies,allowRegistration,sessionTtlMs,authSecret,socialEnv:localAccounts?{}:socialEnv,mailer,requireEmailVerification:verificationRequired});}catch(error){db.close();throw error;}
  const auth=authentication.auth;
  db.exec('CREATE TABLE IF NOT EXISTS oauth_flows (state_hash TEXT PRIMARY KEY,provider TEXT NOT NULL,user_id TEXT,session_id TEXT,popup_id TEXT NOT NULL,expires_at INTEGER NOT NULL) STRICT;');
  let billing;
  const coupons = createCouponService(db, { ...couponOptions, discountsEnabled:()=>billing?.capabilities().discountsEnabled===true, accessBase: userId => billing ? Date.parse(billing.status(userId).accessEndsAt) : 0, monthlyOffers:()=>billing?billing.monthlyOffers():[] });
  async function confirmOwnerPassword(userId, password) {
    if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 1024) fail(401, 'INVALID_CREDENTIALS', 'Password or verification code is incorrect.');
    const row = db.prepare("SELECT password FROM auth_accounts WHERE userId=? AND providerId='credential'").get(userId);
    if (!row || !await verifyCredential({password,hash:row.password})) fail(401, 'INVALID_CREDENTIALS', 'Password or verification code is incorrect.');
  }
  const passkeys = adminAccessMode === 'passkey' ? createAdminPasskeyService(db, { origin: adminPasskeyOrigin, rpId: adminPasskeyRpId || undefined, ownerEmail, coupons, confirmPassword: confirmOwnerPassword }) : null;
  billing = createBillingService(db, {...billingOptions,deployment:mode,discountFor:(userId,offer,base)=>coupons.discount(userId,offer,base)});
  const startedAt=Date.now();let lastHistoryTick=null,historyError=false;
  const ownerOperations=createOwnerOperations(db,{coupons,billing,runtime:()=>({startedAt,lastHistoryTick,historyError,emailConfigured:mailer.available,checkoutEnabled:billing.capabilities().checkoutEnabled,monthlyEnabled:billing.capabilities().monthlyEnabled,monthlyDiscountsAvailable:billing.capabilities().monthlyDiscountsAvailable,offerConfigurationError:billing.capabilities().offerConfigurationError})});
  const billingHistory=billing.history;
  let historyTimer,historyRunning=false,historyTick=Promise.resolve();
  const runHistory=()=>{if(historyRunning)return;historyRunning=true;historyTick=billing.tick(mailer.available&&ownerEmail?async alert=>{
    await mailer.deliver({id:'billing-alert-'+alert.id,to:ownerEmail,subject:'SpentOn billing dispute needs review',text:`Owner review needed: ${alert.kind}. Dispute ${alert.disputeId}, payment ${alert.paymentId}. Response deadline: ${alert.respondBy??'Not supplied; check Razorpay now'}. Open Owner administration to review evidence and cancellation status.`,html:`<p>A billing dispute requires owner review.</p><p>Response deadline: ${alert.respondBy??'Not supplied; check Razorpay now'}.</p><p>Open Owner administration for payment details, evidence and cancellation status.</p>`});
  }:undefined).then(()=>{lastHistoryTick=Date.now();historyError=false;}).catch(()=>{historyError=true;}).finally(()=>{historyRunning=false;});};
  const ownerTesting=createOwnerTestingService(db,{isAdmin:coupons.isAdmin});
  const accountReset=createAccountResetService(db,{coupons});
  const receiptScans=createReceiptScans(db,scanOptions);
  let onboarding;
  const erasure=createErasureService(db,dbPath);
  let emailPreferences,emailTimer,emailTick=Promise.resolve(),emailRunning=false;
  const runEmails=()=>{if(emailRunning)return;emailRunning=true;emailTick=emailPreferences.tick().catch(()=>{}).finally(()=>{emailRunning=false;});};
  db.exec('CREATE TABLE IF NOT EXISTS account_mail_limits (key TEXT PRIMARY KEY,last_sent INTEGER NOT NULL) STRICT;');
  const mailAllowed=(kind,email)=>{
   const key=digest(kind+':'+email),now=Date.now();
   db.prepare('DELETE FROM account_mail_limits WHERE last_sent<?').run(now-86400000);
   if((db.prepare('SELECT last_sent FROM account_mail_limits WHERE key=?').get(key)?.last_sent??0)>now-60000)return false;
   if(db.prepare('SELECT count(*) AS n FROM account_mail_limits').get().n>=10000)return false;
   db.prepare('INSERT INTO account_mail_limits(key,last_sent) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET last_sent=excluded.last_sent').run(key,now);return true;
  };
  const accountLink=(token,kind)=>{
   if(typeof token!=='string'||token.length<20||token.length>4096)fail(400,'INVALID_LINK','This link is invalid or expired. Request a new one.');
   const row=db.prepare('SELECT l.* FROM account_links l JOIN auth_users u ON u.id=l.user_id AND u.email=l.email WHERE l.token_hash=? AND l.kind=? AND l.expires_at>?').get(digest(token),kind,Date.now());
   if(!row)fail(400,'INVALID_LINK','This link is invalid or expired. Request a new one.');return row;
  };
  db.exec('CREATE TABLE IF NOT EXISTS auth_rate_limits (key TEXT PRIMARY KEY, attempt_count INTEGER NOT NULL, resets_at INTEGER NOT NULL) STRICT;');
  db.exec('CREATE TABLE IF NOT EXISTS auth_account_rate_limits (key TEXT PRIMARY KEY, attempt_count INTEGER NOT NULL, resets_at INTEGER NOT NULL) STRICT;');
  const userFrom = async req => {
    const current=await auth.api.getSession({headers:authHeaders(req),query:{disableCookieCache:true}});
    if(!current)fail(401,'UNAUTHENTICATED','Your session has expired. Sign in again.');
    if(verificationRequired&&!current.user.emailVerified)fail(403,'EMAIL_NOT_VERIFIED','Verify your email before signing in. You can request a new verification email.');
    req.authSessionId=current.session.id;
    return {id:current.user.id,email:current.user.email,isAdmin:coupons.isAdmin(current.user.id),lastSignInMethod:authentication.lastSignInMethod(current.user.id)};
  };
  const budgetChanges = createBudgetChanges();
  const notifications = createPushNotifications(db,pushOptions);
  const sharedExpenses = createSharedExpenses(db,{operations,origin:allowedOrigins[0],notify:notifications.enqueue,requireEditing:id=>billing.requireEditing(id),publish:(userId,budgetId)=>budgetChanges.publish(userId,budgetId),recordChange:(userId,snapshot,operationId)=>{onboarding.syncBudget(userId,snapshot.id,snapshot.budget);billingHistory.record(userId,'budget.saved',operationId);}});
  const nativeAuth = createNativeAuth();
  const nativeAuthTimer = setInterval(() => nativeAuth.prune(), 30000); nativeAuthTimer.unref();
  let queue=Promise.resolve(),queued=0,reading=0;
  async function prefetch(req,limit,mediaType='json'){if(reading>=16)fail(429,'RATE_LIMITED','The service is busy. Try again shortly.');reading++;try{return await readRaw(req,limit,mediaType);}finally{reading--;}}
  async function acquire(){
    if(queued>=32)fail(429,'RATE_LIMITED','The service is busy. Try again shortly.');
    queued++;
    const previous=queue;let release;
    queue=new Promise(resolve=>{release=()=>{queued--;resolve();};});
    await previous;return release;
  }
  const receiptRetentionTimer=setInterval(()=>{void acquire().then(done=>{try{receiptScans.prune();}finally{done();}}).catch(()=>{});},60000);receiptRetentionTimer.unref();
  let notificationTick, notificationTimer;
  const withNotificationLock = async action => { const release = await acquire(); try { return action(); } finally { release(); } };
  const runNotifications = () => { if (!notificationTick) notificationTick = notifications.flush(withNotificationLock).catch(() => {}).finally(() => { notificationTick = undefined; }); };
  function limitAuth(req) {
    const now=Date.now(),key=digest(clientIp(req));
    db.prepare('DELETE FROM auth_rate_limits WHERE resets_at<=?').run(now);
    const attempt=db.prepare('SELECT attempt_count FROM auth_rate_limits WHERE key=?').get(key);
    if((attempt?.attempt_count??0)>=authLimit||(!attempt&&db.prepare('SELECT count(*) AS n FROM auth_rate_limits').get().n>=1000))fail(429,'RATE_LIMITED','Too many sign-in attempts. Try again later.');
    db.prepare('INSERT INTO auth_rate_limits(key,attempt_count,resets_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempt_count=attempt_count+1').run(key,now+authWindowMs);
  }
  function limitAccountAuth(email) {
    const now=Date.now(),key=digest('account-login:'+email);
    db.prepare('DELETE FROM auth_account_rate_limits WHERE resets_at<=?').run(now);
    const attempt=db.prepare('SELECT attempt_count FROM auth_account_rate_limits WHERE key=?').get(key);
    if((attempt?.attempt_count??0)>=accountAuthLimit||(!attempt&&db.prepare('SELECT count(*) AS n FROM auth_account_rate_limits').get().n>=10000))fail(429,'RATE_LIMITED','Too many sign-in attempts. Try again later.');
    db.prepare('INSERT INTO auth_account_rate_limits(key,attempt_count,resets_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempt_count=attempt_count+1').run(key,now+authWindowMs);
  }
  function clientIp(req) {
    let client;
    try {
      client = normalizedIp(req.socket.remoteAddress);
      if (trustedProxies.has(client)) {
        const forwarded = req.headers['x-forwarded-for'];
        if (typeof forwarded !== 'string') throw new Error('Missing client address.');
        const parts = forwarded.split(',');
        if (parts.length > 20) throw new Error('Too many proxies.');
        const chain = parts.map(part => normalizedIp(part.trim()));
        for (let i = chain.length - 1; i >= 0 && trustedProxies.has(client); i--) client = chain[i];
      }
    } catch { fail(403, 'ADMIN_NETWORK_REJECTED', 'The client network could not be verified.'); }
    return client;
  }
  function requireAdminNetwork(req) {
    const client = clientIp(req);
    if (!adminIps.has(client)) fail(403, 'ADMIN_NETWORK_REJECTED', 'Owner access is not allowed from this network.');
    if (requireAdminDevice) {
      const serial = req.headers['x-spenton-client-serial'];
      if (!trustedProxies.has(normalizedIp(req.socket.remoteAddress)) || req.headers['x-spenton-client-verify'] !== 'SUCCESS' || typeof serial !== 'string' || !deviceSerials.has(serial.toUpperCase())) {
        fail(403, 'ADMIN_DEVICE_REJECTED', 'Owner access requires an approved device certificate.');
      }
    }
  }
  const snapshot = row => ({ id: row.id, revision: row.revision, updatedAt: new Date(row.updated_at).toISOString(), budget: JSON.parse(row.document), subscriptionVersion:1, plannedShares:sharedExpenses.people.plans(row.owner_id,row.id) });
  const respond = (res, status, body) => { res.writeHead(status); res.end(body === undefined ? undefined : JSON.stringify(body)); };

  const server = createServer({ maxHeaderSize: 16384, requestTimeout: 15000, headersTimeout: 10000 }, async (req, res) => {
    req.on('error', () => {});
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Origin');
    const origin = req.headers.origin;
    if (origin && origins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    let release;
    try {
      const method = req.method;
      const path = new URL(req.url, 'http://api.invalid').pathname;
      if(staticFiles&&!path.startsWith('/api/'))return await staticFiles(req,res);
      const oauthCallback=/^\/api\/auth\/callback\/(google|microsoft|apple)$/.exec(path);
      if(oauthCallback&&['GET','POST'].includes(method)){
        const provider=oauthCallback[1];
        if(!authentication.providers.some(p=>p.id===provider&&p.available))fail(404,'NOT_FOUND','Sign-in provider is unavailable.');
        let callbackBody;
        if(method==='POST'){
          if(provider!=='apple'||!/^application\/x-www-form-urlencoded(?:;|$)/i.test(req.headers['content-type']??''))fail(415,'INVALID_CALLBACK','Unexpected callback format.');
          // Apple uses a bounded form POST; every callback still requires the
          // signed browser state cookie and a one-use server-side state record.
          callbackBody=await prefetch(req,16384,'form');
        }
        release=await acquire();
        const params=method==='POST'?new URLSearchParams(callbackBody.toString('utf8')):new URL(req.url,allowedOrigins[0]).searchParams;
        const state=params.get('state'),flow=state&&state.length<=256?db.prepare('SELECT * FROM oauth_flows WHERE state_hash=?').get(digest(state)):null;
        const rejectCallback=()=>{res.writeHead(303,{Location:nativeAuth.finish(flow?.popup_id)??(allowedOrigins[0]+'/?auth=error'+(flow?.popup_id?'&popup='+flow.popup_id:''))});res.end();};
        if(!flow||flow.provider!==provider||flow.expires_at<=Date.now())return rejectCallback();
        if(flow.session_id&&!db.prepare('SELECT 1 FROM auth_sessions WHERE id=? AND userId=? AND expiresAt>?').get(flow.session_id,flow.user_id,new Date().toISOString()))return rejectCallback();
        const headers=authHeaders(req);if(method==='POST')headers.set('content-type','application/x-www-form-urlencoded');
        let result;
        try{result=await auth.handler(new Request(allowedOrigins[0]+req.url,{method,headers,...(callbackBody?{body:callbackBody}:{}),signal:AbortSignal.timeout(15000)}));}
        catch{return rejectCallback();}
        finally{db.prepare('DELETE FROM oauth_flows WHERE state_hash=?').run(digest(state));}
        const location=result.headers.get('location');
        if(location){const target=new URL(location,allowedOrigins[0]);if(target.origin!==allowedOrigins[0]||target.pathname!=='/')return rejectCallback();}
        let nativeCookies;
        // Only a completed login with its newly issued, verified session records a method.
        // Connecting a provider to an existing session is not a login.
        if(location&&!flow.user_id&&new URL(location,allowedOrigins[0]).searchParams.get('auth')==='complete'){
          const cookies=result.headers.getSetCookie();
          if(cookies.some(value=>/^(?:__Secure-)?spenton\.session_token=/.test(value))){
            const sessionHeaders=new Headers({cookie:cookies.map(value=>value.split(';')[0]).join('; ')});
            const current=await auth.api.getSession({headers:sessionHeaders,query:{disableCookieCache:true}});
            if(current&&db.prepare('SELECT 1 FROM auth_accounts WHERE userId=? AND providerId=?').get(current.user.id,provider)){
              authentication.recordSignIn(current.user.id,provider);billingHistory.record(current.user.id,'auth.signed_in',digest('oauth:'+current.session.id));
              if(!verificationRequired||current.user.emailVerified)nativeCookies=cookies.filter(value=>/^(?:__Secure-)?spenton\.session_token=/.test(value));
            }
          }
        }
        const nativeCallback=nativeAuth.finish(flow.popup_id,nativeCookies);
        if(nativeCallback){res.writeHead(303,{Location:nativeCallback});res.end();return;}
        if(result.headers.getSetCookie().length)res.setHeader('Set-Cookie',result.headers.getSetCookie());
        if(location){res.writeHead(303,{Location:location});res.end();return;}
        return rejectCallback();
      }
      if(method==='POST'&&path==='/api/email/one-click'){
        const raw=await prefetch(req,1024,'form');
        if(new URLSearchParams(raw.toString('utf8')).get('List-Unsubscribe')!=='One-Click')fail(400,'INVALID_UNSUBSCRIBE','Invalid unsubscribe request.');
        release=await acquire();emailPreferences.unsubscribe(new URL(req.url,allowedOrigins[0]).searchParams.get('token'));return respond(res,200,{accepted:true});
      }
      if (method === 'POST' && path === '/api/billing/webhook') {
        if(mode!=='cloud')fail(404,'NOT_FOUND','Endpoint not found.');
        const raw = await prefetch(req, 256 * 1024);
        release=await acquire();
        return respond(res, 200, await billing.webhook(raw, req.headers['x-razorpay-signature'], req.headers['x-razorpay-event-id']));
      }
      if (!['GET', 'HEAD'].includes(method)) {
        if (!origin || !origins.has(origin)) fail(403, 'ORIGIN_REJECTED', 'This request origin is not allowed.');
        if (req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'ORIGIN_REJECTED', 'Cross-site requests are not allowed.');
      }
      if (method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return respond(res, 204);
      }
      // Reject anonymous large uploads before reserving body-reader capacity.
      // Release the DB lock while reading; identity is checked again afterwards.
      if(['POST','PUT'].includes(method)&&path.startsWith('/api/budgets')){
        release=await acquire();
        try{await userFrom(req);}catch(error){res.setHeader('Connection','close');throw error;}
        finally{release();release=undefined;}
      }
      if(['POST','PUT'].includes(method)&&path!=='/api/auth/logout'&&(Number(req.headers['content-length'])>0||req.headers['transfer-encoding']||req.headers['content-type'])){req.cachedRaw=await prefetch(req,(path.startsWith('/api/budgets')||path.startsWith('/api/owner-tests'))?maxBodyBytes:Math.min(maxBodyBytes,path==='/api/receipt-scans'?SCAN_BODY_LIMIT:path==='/api/shared-expenses'?2800000:path.startsWith('/api/admin/passkey/')?32768:8192));}
      release=await acquire();
      if (method === 'GET' && path === '/api/health') return respond(res, 200, { ok: true, service: 'spenton-api', version: 1 });
      if (method === 'GET' && path === '/api/server') return respond(res, 200, capabilities);
      if(method==='POST'&&path==='/api/email/unsubscribe'){const body=await readJson(req,8192);emailPreferences.unsubscribe(body.token);return respond(res,200,{message:'Reminder emails are now off for this subscription.'});}
      if(method==='GET'&&path==='/api/auth/email-status')return respond(res,200,{available:mailer.available,verificationRequired});
      if(method==='POST'&&['/api/auth/request-reset','/api/auth/send-verification'].includes(path)){
        limitAuth(req);const body=await readJson(req,8192);
        const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)fail(400,'INVALID_EMAIL','Enter a valid email address.');
        if(!mailer.available)fail(503,'EMAIL_UNAVAILABLE','Account email is being set up. Please try again later.');
        if(mailAllowed(path,email)){
          const headers=new Headers({origin:allowedOrigins[0]});
          const result=await (path.endsWith('/request-reset')?auth.api.requestPasswordReset({headers,body:{email,redirectTo:allowedOrigins[0]+'/?account-action=reset'},asResponse:true}):auth.api.sendVerificationEmail({headers,body:{email,callbackURL:allowedOrigins[0]+'/'},asResponse:true}));
          if(result.status>=500)fail(503,'EMAIL_UNAVAILABLE','Account email is temporarily unavailable. Please try again later.');
        }
        return respond(res,200,{accepted:true,message:'If the account is eligible, an email will arrive shortly. You can request another link after one minute.'});
      }
      if(method==='POST'&&['/api/auth/confirm-reset','/api/auth/confirm-email'].includes(path)){
        limitAuth(req);const body=await readJson(req,8192),reset=path.endsWith('/confirm-reset');
        const link=accountLink(body.token,reset?'reset':'verify');
        if(reset)credentials({email:link.email,password:body.password});
        const headers=new Headers({origin:allowedOrigins[0]}),nativeToken=authentication.emailToken(link);
        const result=await (reset?auth.api.resetPassword({headers,body:{token:nativeToken,newPassword:body.password},asResponse:true}):auth.api.verifyEmail({headers,query:{token:nativeToken},asResponse:true}));
        if(!result.ok)fail(400,'INVALID_LINK','This link is invalid or expired. Request a new one.');
        if(reset){
          db.prepare('UPDATE auth_users SET emailVerified=1,updatedAt=? WHERE id=?').run(new Date().toISOString(),link.user_id);
          db.prepare('DELETE FROM auth_verifications WHERE value=?').run(link.user_id);
          db.prepare('DELETE FROM account_links WHERE user_id=?').run(link.user_id);
        }else db.prepare('DELETE FROM account_links WHERE token_hash=?').run(link.token_hash);
        return respond(res,200,{completed:true});
      }
      if(method==='POST'&&path==='/api/auth/native'){
        limitAuth(req);
        const body=await readJson(req,8192);
        if(!authentication.providers.some(p=>p.id===body.provider&&p.available))fail(503,'PROVIDER_UNAVAILABLE','This sign-in option is not available yet.');
        const flow=nativeAuth.begin(body.provider,body.challenge,body.state);
        return respond(res,200,{url:allowedOrigins[0]+'/api/auth/native/start?ticket='+flow.ticket});
      }
      if(method==='GET'&&path==='/api/auth/native/start'){
        limitAuth(req);
        const flow=nativeAuth.start(new URL(req.url,allowedOrigins[0]).searchParams.get('ticket'));
        const reject=()=>{res.writeHead(303,{Location:nativeAuth.finish(flow.popup)});res.end();};
        try{
          // Start in the system browser with fresh state, independent of any old
          // browser login. Better Auth binds its provider callback to this cookie.
          const result=await auth.api.signInSocial({headers:new Headers({origin:allowedOrigins[0]}),body:{provider:flow.provider,callbackURL:allowedOrigins[0]+'/?auth=complete&popup='+flow.popup,errorCallbackURL:allowedOrigins[0]+'/?auth=error&popup='+flow.popup,disableRedirect:true},asResponse:true});
          if(!result.ok)return reject();
          const data=await result.json(),url=new URL(data.url),state=url.searchParams.get('state');
          if(url.protocol!=='https:'||!state)return reject();
          db.prepare('DELETE FROM oauth_flows WHERE expires_at<=?').run(Date.now());
          db.prepare('INSERT INTO oauth_flows(state_hash,provider,user_id,session_id,popup_id,expires_at) VALUES(?,?,NULL,NULL,?,?)').run(digest(state),flow.provider,flow.popup,Date.now()+5*60000);
          res.setHeader('Set-Cookie',result.headers.getSetCookie());
          res.writeHead(303,{Location:data.url});res.end();return;
        }catch{return reject();}
      }
      if(method==='POST'&&path==='/api/auth/native/exchange'){
        limitAuth(req);
        const body=await readJson(req,8192),cookies=nativeAuth.exchange(body.code,body.verifier);
        const nativeRequest={headers:{cookie:cookies.map(value=>value.split(';')[0]).join('; ')}};
        // Recheck revocation and verified identity at redemption, never accept an
        // identity supplied by the phone or the provider redirect parameters.
        const user=await userFrom(nativeRequest);
        res.setHeader('Set-Cookie',cookies);
        return respond(res,200,{user});
      }
      if(method==='GET'&&path==='/api/auth/providers')return respond(res,200,{providers:authentication.providers,nativeAuthentication:true,localAccounts});
      if(method==='POST'&&['/api/auth/social','/api/auth/connect'].includes(path)){
        limitAuth(req);
        const body=await readJson(req,8192),provider=body.provider;
        if(typeof body.popupId!=='string'||!/^[0-9a-f-]{36}$/.test(body.popupId))fail(400,'INVALID_FLOW','Start sign-in from the SpentOn page.');
        if(!authentication.providers.some(p=>p.id===provider&&p.available))fail(503,'PROVIDER_UNAVAILABLE','This sign-in option is not available yet.');
        const connecting=path==='/api/auth/connect';
        const current=connecting?await userFrom(req):null;
        if(connecting){
          const session=db.prepare('SELECT createdAt FROM auth_sessions WHERE id=?').get(req.authSessionId);
          if(Date.now()-Date.parse(session.createdAt)>5*60000)fail(403,'FRESH_LOGIN_REQUIRED','Sign out and sign in again before connecting a sign-in method.');
        }
        const input={headers:authHeaders(req),body:{provider,callbackURL:allowedOrigins[0]+'/?auth=complete&popup='+body.popupId,errorCallbackURL:allowedOrigins[0]+'/?auth=error&popup='+body.popupId,disableRedirect:true},asResponse:true};
        const result=await (connecting?auth.api.linkSocialAccount(input):auth.api.signInSocial(input));
        if(!result.ok)fail(400,'SOCIAL_SIGN_IN_FAILED','Could not start provider sign-in. Try again.');
        const data=await result.json(),url=new URL(data.url),state=url.searchParams.get('state');
        if(url.protocol!=='https:'||!state)fail(503,'PROVIDER_UNAVAILABLE','Could not start provider sign-in.');
        db.prepare('DELETE FROM oauth_flows WHERE expires_at<=?').run(Date.now());
        db.prepare('INSERT INTO oauth_flows(state_hash,provider,user_id,session_id,popup_id,expires_at) VALUES(?,?,?,?,?,?)').run(digest(state),provider,current?.id??null,connecting?req.authSessionId:null,body.popupId,Date.now()+5*60000);
        res.setHeader('Set-Cookie',result.headers.getSetCookie());
        return respond(res,200,{url:data.url});
      }
      if (method === 'POST' && ['/api/auth/register', '/api/auth/login'].includes(path)) {
        limitAuth(req);
        const input=await readJson(req,Math.min(maxBodyBytes,8192));
        let localEmail;
        if(localAccounts){try{localEmail=localAccountEmail(input.username);}catch(error){fail(400,'INVALID_USERNAME',error.message);}}
        const {email,password}=credentials(localAccounts?{email:localEmail,password:input.password}:input);
        const registering=path==='/api/auth/register';
        if(!registering)limitAccountAuth(email);
        if(registering&&!allowRegistration)fail(403,'REGISTRATION_CLOSED','Registration is currently closed. Contact the service owner for access.');
        const headers=authHeaders(req);
        const previous=await auth.api.getSession({headers});
        let result;
        try{
          result=await (registering?auth.api.signUpEmail({headers,body:{email,password,name:email.split('@')[0]},asResponse:true}):auth.api.signInEmail({headers,body:{email,password},asResponse:true}));
        }catch{fail(503,'AUTH_UNAVAILABLE','Sign-in is temporarily unavailable. Try again shortly.');}
        if(!result.ok){
          if(result.status>=500)fail(503,'AUTH_UNAVAILABLE','Sign-in is temporarily unavailable. Try again shortly.');
          if(!registering&&result.status===403)fail(403,'EMAIL_NOT_VERIFIED','Verify your email before signing in. You can request a new verification email below.');
          if(registering)fail(result.status===422?409:result.status,'ACCOUNT_UNAVAILABLE',localAccounts?'This username is already registered. Try signing in.':'This email cannot be registered. Try signing in.');
          fail(result.status===429?429:401,'INVALID_CREDENTIALS',localAccounts?'Username or password is incorrect.':'Email or password is incorrect.');
        }
        const data=await result.json();
        // This reserved identifier is a local principal, not a verified external mailbox.
        if(registering&&localAccounts)db.prepare('UPDATE auth_users SET emailVerified=1 WHERE id=? AND email=?').run(data.user.id,localEmail);
        if(!registering)db.prepare('DELETE FROM auth_account_rate_limits WHERE key=?').run(digest('account-login:'+email));
        if(registering&&verificationRequired)return respond(res,201,{verificationRequired:true});
        authentication.recordSignIn(data.user.id,'password');
        billingHistory.record(data.user.id,'auth.signed_in',digest('login:'+(data.token??randomUUID())));
        if(previous)db.prepare('DELETE FROM auth_sessions WHERE id=?').run(previous.session.id);
        res.setHeader('Set-Cookie',result.headers.getSetCookie());
        return respond(res,registering?201:200,{user:{id:data.user.id,email:data.user.email,isAdmin:coupons.isAdmin(data.user.id),lastSignInMethod:'password'}});
      }
      if (method === 'POST' && path === '/api/auth/logout') {
        const result=await auth.api.signOut({headers:authHeaders(req),asResponse:true});
        res.setHeader('Set-Cookie',[...result.headers.getSetCookie(),`spenton_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${secureCookies?'; Secure':''}`]);
        return respond(res,204);
      }
      const user = await userFrom(req);
      if(method==='POST'&&path==='/api/operations/resolve')return respond(res,200,operations.resolve(user.id,await readJson(req,2048)));
      if(mode!=='cloud'&&path.startsWith('/api/billing/'))fail(404,'NOT_FOUND','Cloud billing is not used on this server.');
      if(method==='GET'&&path==='/api/notifications/capabilities') return respond(res,200,{sharedUpdates:notifications.available});
      if(method==='POST'&&path==='/api/notifications/devices') { const body=await readJson(req,4096); await userFrom(req); return respond(res,200,notifications.register(user.id,req.authSessionId,body)); }
      if(method==='GET'&&path==='/api/expense-groups')return respond(res,200,sharedExpenses.groups.list(user.id));
      if(method==='GET'&&path==='/api/people')return respond(res,200,sharedExpenses.people.list(user.id));
      if(method==='POST'&&path==='/api/people'){const body=await readJson(req,8192);await userFrom(req);return respond(res,200,sharedExpenses.people.create(user.id,body));}
      if(method==='POST'&&path==='/api/group-bills'){const body=await readJson(req,32768);await userFrom(req);return respond(res,200,sharedExpenses.groups.bills.create(user.id,body));}
      const combinedBill=/^\/api\/group-bills\/([0-9a-f-]{36})(?:\/(preview|confirm|accept))?$/.exec(path);
      if(combinedBill&&method==='GET'&&!combinedBill[2])return respond(res,200,sharedExpenses.groups.bills.get(user.id,combinedBill[1]));
      if(combinedBill&&method==='POST'&&combinedBill[2]){const body=await readJson(req,8192);await userFrom(req);return respond(res,200,combinedBill[2]==='preview'?sharedExpenses.groups.bills.get(user.id,combinedBill[1],body):sharedExpenses.groups.bills[combinedBill[2]](user.id,combinedBill[1],body));}
      if(method==='POST'&&path==='/api/group-bill-series'){const body=await readJson(req,32768);await userFrom(req);return respond(res,200,sharedExpenses.groups.bills.saveSeries(user.id,body));}
      const groupSeries=/^\/api\/group-bill-series\/([0-9a-f-]{36})$/.exec(path);
      if(groupSeries&&method==='POST'){const body=await readJson(req,32768);await userFrom(req);return respond(res,200,sharedExpenses.groups.bills.changeSeries(user.id,groupSeries[1],body));}
      if(method==='POST'&&path==='/api/expense-groups'){const body=await readJson(req,8192);await userFrom(req);return respond(res,200,sharedExpenses.groups.create(user.id,body));}
      const expenseGroup=/^\/api\/expense-groups\/([0-9a-f-]{36})$/.exec(path);
      if(expenseGroup&&method==='GET')return respond(res,200,sharedExpenses.groups.get(user.id,expenseGroup[1]));
      if(expenseGroup&&method==='POST'){const body=await readJson(req,8192);await userFrom(req);return respond(res,200,sharedExpenses.groups.update(user.id,expenseGroup[1],body));}
      const groupInvite=/^\/api\/expense-group-members\/([0-9a-f-]{36})\/invite$/.exec(path);
      if(groupInvite&&method==='POST'){const body=await readJson(req,8192);await userFrom(req);return respond(res,200,sharedExpenses.groups.invite(user.id,groupInvite[1],body));}
      if(method==='POST'&&path==='/api/group-invitations/preview')return respond(res,200,sharedExpenses.groups.previewInvitation(user.id,await readJson(req,2048)));
      if(method==='POST'&&path==='/api/group-invitations/join'){const body=await readJson(req,8192);await userFrom(req);return respond(res,200,sharedExpenses.groups.join(user.id,body));}
      if(method==='GET'&&path==='/api/shared-changes')return respond(res,200,{changes:sharedExpenses.groups.listChanges(user.id)});
      if(method==='POST'&&path==='/api/shared-changes'){const body=await readJson(req,8192);await userFrom(req);return respond(res,200,sharedExpenses.groups.propose(user.id,body));}
      const sharedChange=/^\/api\/shared-changes\/([0-9a-f-]{36})$/.exec(path);
      if(sharedChange&&method==='GET')return respond(res,200,sharedExpenses.groups.change(user.id,sharedChange[1]));
      if(sharedChange&&method==='POST'){const body=await readJson(req,8192);await userFrom(req);return respond(res,200,sharedExpenses.groups.review(user.id,sharedChange[1],body));}
      if(method==='POST'&&path==='/api/share-invitations/preview')return respond(res,200,sharedExpenses.previewInvitation(user.id,await readJson(req,2048)));
      if(method==='POST'&&path==='/api/share-invitations/claim')return respond(res,200,sharedExpenses.claimInvitation(user.id,await readJson(req,2048)));
      const sharedBill=/^\/api\/shared-expenses\/([0-9a-f-]{36})\/receipt$/.exec(path);
      if(method==='GET'&&sharedBill)return respond(res,200,sharedExpenses.sharedReceipt(user.id,sharedBill[1]));
      const sharedDetail=/^\/api\/shared-expenses\/([0-9a-f-]{36})$/.exec(path);
      if(method==='GET'&&sharedDetail) return respond(res,200,sharedExpenses.get(user.id,sharedDetail[1]));
      if(method==='GET'&&path==='/api/shared-expenses'){const query=new URL(req.url,'http://api.invalid').searchParams;return respond(res,200,sharedExpenses.list(user.id,{person:query.get('person')??'',offset:Number(query.get('offset')??0),groupId:query.get('group')??''}));}
      if(method==='POST'&&path==='/api/shared-expenses'){const body=await readJson(req,2800000);await userFrom(req);return respond(res,200,sharedExpenses.create(user.id,body));}
      const shareAction=/^\/api\/expense-shares\/([0-9a-f-]{36})\/(respond|repay|invite|receive)$/.exec(path);
      if(shareAction&&method==='POST'){const body=await readJson(req,8192);await userFrom(req);return respond(res,200,sharedExpenses[shareAction[2]](user.id,shareAction[1],body));}
      const recordReceived=/^\/api\/share-settlements\/([0-9a-f-]{36})\/record$/.exec(path);
      if(method==='POST'&&recordReceived){const body=await readJson(req,8192);await userFrom(req);return respond(res,200,sharedExpenses.recordReceivedPayment(user.id,recordReceived[1],body));}
      const settlementAction=/^\/api\/share-settlements\/([0-9a-f-]{36})$/.exec(path);
      if(settlementAction&&method==='POST'){const body=await readJson(req,8192);await userFrom(req);return respond(res,200,sharedExpenses.confirm(user.id,settlementAction[1],body));}
      if(method==='GET'&&path==='/api/receipt-scans/capabilities')return respond(res,200,receiptScans.capabilities());
      if(method==='POST'&&path==='/api/receipt-scans'){
        const body=await readJson(req,SCAN_BODY_LIMIT);await userFrom(req);billing.requireEditing(user.id);
        const job=receiptScans.begin(user.id,body);
        if(job.replay)return respond(res,200,job.replay);
        release();release=undefined;
        const outcome=await receiptScans.perform(job);
        release=await acquire();
        const result=receiptScans.finish(job,outcome);
        await userFrom(req);
        return respond(res,200,result);
      }
      const scanPath=/^\/api\/receipt-scans\/([0-9a-f-]{36})(\/visible)?$/.exec(path);
      if(scanPath&&method==='GET'&&!scanPath[2])return respond(res,200,receiptScans.get(user.id,scanPath[1]));
      if(scanPath&&method==='POST'&&scanPath[2]){const body=await readJson(req,1024);return respond(res,200,receiptScans.visible(user.id,scanPath[1],body.elapsedMs));}
      if(method==='GET'&&path==='/api/account/budget-reset')return respond(res,200,accountReset.review(user.id));
      if(method==='POST'&&['/api/account/budget-reset/confirm','/api/account/budget-reset/cancel'].includes(path)){
        const body=await readJson(req,2048);await userFrom(req);
        return respond(res,200,path.endsWith('/confirm')?accountReset.confirm(user.id,body):accountReset.cancel(user.id,body));
      }
      if(method==='GET'&&path==='/api/account/email-preferences')return respond(res,200,emailPreferences.get(user.id));
      if(method==='PUT'&&path==='/api/account/email-preferences'){const body=await readJson(req,8192);try{return respond(res,200,emailPreferences.save(user.id,body));}catch(error){fail(400,'INVALID_PREFERENCES',error.message);}}
      if(localAccounts&&method==='POST'&&path==='/api/account/password'){
        limitAuth(req);const body=await readJson(req,8192);
        await confirmOwnerPassword(user.id,body.currentPassword);
        try{await resetLocalPassword(db,localUsername(user.email),body.password);}catch(error){fail(400,'INVALID_PASSWORD',error.message);}
        return respond(res,200,{message:'Password changed. Sign in again with your new password.'});
      }
      if(localAccounts&&method==='POST'&&path==='/api/account/delete-local'){
        limitAuth(req);const body=await readJson(req,8192);
        if(body.confirmation!=='DELETE')fail(400,'CONFIRMATION_REQUIRED','Type DELETE to confirm permanent account deletion.');
        await confirmOwnerPassword(user.id,body.password);
        if(archiveErasure){try{await archiveErasure(user.id);}catch{fail(503,'DELETION_ARCHIVE_UNAVAILABLE','Account deletion could not be safely recorded. Try again.');}}
        return respond(res,200,erasure.erase(user.id));
      }
      if(method==='GET'&&path==='/api/account'){
        const profile=db.prepare('SELECT emailVerified FROM auth_users WHERE id=?').get(user.id);
        return respond(res,200,{email:user.email,localAccounts,username:localAccounts?localUsername(user.email):undefined,emailVerified:!localAccounts&&!!profile.emailVerified,emailAvailable:mailer.available,hasPassword:!!db.prepare("SELECT 1 FROM auth_accounts WHERE userId=? AND providerId='credential'").get(user.id),budgetCount:db.prepare('SELECT count(*) AS n FROM budgets WHERE owner_id=?').get(user.id).n});
      }
      if(['GET','POST'].includes(method)&&path==='/api/account/export'){
        let exportOperation;if(method==='POST'){const body=await readJson(req,8192);if(!operationId(body.operationId))fail(400,'OPERATION_REQUIRED','Use a unique export operation ID.');exportOperation=body.operationId;}
        res.setHeader('Content-Disposition','attachment; filename="spenton-account-data.json"');
        const exportedData={...exportAccountData(db,user.id,{includeCloud:mode==='cloud'}),...(mode==='cloud'?{billingServiceHistory:billingHistory.personal(user.id)}:{})};
        if(exportOperation)billingHistory.record(user.id,'export.prepared',exportOperation);
        return respond(res,200,exportedData);
      }
      if(method==='POST'&&path==='/api/account/delete-request'){
        limitAuth(req);
        if(!mailer.available)fail(503,'EMAIL_UNAVAILABLE','Account email is being set up. Contact privacy@spenton.dev for help with deletion.');
        if(mailAllowed('delete',user.email)){
          const token=randomBytes(32).toString('base64url');
          db.prepare("DELETE FROM account_links WHERE user_id=? AND kind='delete'").run(user.id);
          db.prepare('INSERT INTO account_links(token_hash,user_id,email,kind,expires_at) VALUES(?,?,?,?,?)').run(digest(token),user.id,user.email,'delete',Date.now()+1800000);
          mailer.send({id:randomUUID(),to:user.email,...emailTemplate('delete',{url:allowedOrigins[0]+'/?account-action=delete#token='+token,origin:allowedOrigins[0]})});
        }
        return respond(res,200,{accepted:true,message:'Check your inbox to review and confirm deletion. Nothing is deleted until you confirm.'});
      }
      if(method==='POST'&&path==='/api/account/delete'){
        limitAuth(req);const body=await readJson(req,8192),link=accountLink(body.token,'delete');
        if(link.user_id!==user.id)fail(403,'WRONG_ACCOUNT','Sign in to the account that requested this deletion.');
        if(body.confirmation!=='DELETE')fail(400,'CONFIRMATION_REQUIRED','Type DELETE to confirm permanent account deletion.');
        const open=mode==='cloud'?db.prepare("SELECT * FROM billing_checkouts WHERE user_id=? AND state IN ('creating','pending','active')").all(user.id):[];
        for(const checkout of open){
          if(checkout.offer!=='monthly'||!checkout.provider_id)fail(409,'PAYMENT_PENDING','Resolve your pending payment before deleting your account. Contact privacy@spenton.dev if you need help.');
          await billing.cancel(user.id,checkout.id);
          const current=db.prepare('SELECT provider_status FROM billing_checkouts WHERE id=?').get(checkout.id);
          if(!['cancelled','completed','expired'].includes(current.provider_status))fail(409,'CANCELLATION_PENDING','Subscription cancellation is not confirmed yet. Please retry deletion after it is confirmed.');
        }
        // Revalidate after provider work so a delayed response cannot consume an expired link.
        accountLink(body.token,'delete');
        if (archiveErasure) {
          try { await archiveErasure(user.id); }
          catch { fail(503, 'DELETION_ARCHIVE_UNAVAILABLE', 'Account deletion could not be safely recorded. Please try again shortly.'); }
        }
        const result=erasure.erase(user.id);
        const names=['spenton.session_token','__Secure-spenton.session_token','spenton_session'];
        res.setHeader('Set-Cookie',names.map(name=>name+'=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0'+(secureCookies?'; Secure':'')));
        return respond(res,200,result);
      }
      if(method==='GET'&&path==='/api/auth/connections')return respond(res,200,{providers:db.prepare('SELECT providerId FROM auth_accounts WHERE userId=?').all(user.id).map(row=>row.providerId)});
      if(path==='/api/owner-tests'||path.startsWith('/api/owner-tests/')){
        if(!coupons.isAdmin(user.id))fail(403,'ADMIN_REQUIRED','Owner access is required for test budgets.');
        if(path==='/api/owner-tests'&&method==='GET')return respond(res,200,ownerTesting.list(user.id));
        if(path==='/api/owner-tests'&&method==='POST'){const body=await readJson(req,maxBodyBytes);await userFrom(req);const result=ownerTesting.create(user.id,body);return respond(res,result.replayed?200:201,result);}
        const test=/^\/api\/owner-tests\/([0-9a-f-]{36})(?:\/(feedback|export))?$/.exec(path);
        if(test){
          if(method==='GET'&&!test[2])return respond(res,200,ownerTesting.get(user.id,test[1]));
          if(['PUT','POST','DELETE'].includes(method)){const body=await readJson(req,maxBodyBytes);await userFrom(req);
            if(method==='PUT'&&!test[2])return respond(res,200,ownerTesting.update(user.id,test[1],body));
            if(method==='DELETE'&&!test[2])return respond(res,200,ownerTesting.remove(user.id,test[1],body));
            if(method==='POST'&&test[2]==='feedback')return respond(res,200,ownerTesting.feedback(user.id,test[1],body));
            if(method==='POST'&&test[2]==='export')return respond(res,200,ownerTesting.get(user.id,test[1]));
          }
        }
        fail(404,'NOT_FOUND','Test endpoint not found.');
      }
      if(method==='POST'&&path==='/api/onboarding/feedback'){const body=await readJson(req,8192);await userFrom(req);return respond(res,200,onboarding.feedback(user.id,body));}
      if(method==='GET'&&path==='/api/onboarding')return respond(res,200,onboarding.get(user.id));
      if(method==='POST'&&path==='/api/onboarding/command'){const body=await readJson(req,4096);await userFrom(req);return respond(res,200,onboarding.command(user.id,body));}
      if(method==='POST'&&path==='/api/onboarding/event'){const body=await readJson(req,2048);await userFrom(req);return respond(res,200,onboarding.event(user.id,body));}
      if (method === 'GET' && path === '/api/auth/me') return respond(res, 200, { user });
      if (method === 'GET' && path === '/api/usage') return respond(res, 200, coupons.usage(user.id));
      if(method==='GET'&&path==='/api/billing/quote')return respond(res,200,billing.quote(user.id,new URL(req.url,'http://api.invalid').searchParams.get('offer')));
      if (method === 'GET' && path === '/api/billing/terms') return respond(res,200,billing.purchaseTerms);
      if (method === 'GET' && path === '/api/billing') return respond(res, 200, billing.status(user.id));
      if (method === 'POST' && ['/api/billing/checkout','/api/billing/confirm','/api/billing/refresh','/api/billing/cancel'].includes(path)) {
        const body = await readJson(req, 8192);
        await userFrom(req);
        if (path.endsWith('/checkout')) return respond(res, 200, await billing.start(user.id, body.offer, body.consent));
        if (path.endsWith('/confirm')) return respond(res, 200, await billing.confirm(user.id, body));
        if (path.endsWith('/cancel')) return respond(res, 200, await billing.cancel(user.id, body.checkoutId));
        return respond(res, 200, await billing.refresh(user.id));
      }
      if (method === 'POST' && path === '/api/coupons/redeem') {
        const body = await readJson(req, Math.min(maxBodyBytes, 8192));
        await userFrom(req);
        return respond(res, 200, coupons.redeem(user.id, body.code));
      }
      if (path === '/api/admin' || path.startsWith('/api/admin/')) {
        if (!coupons.isAdmin(user.id)) fail(403, 'ADMIN_REQUIRED', 'Owner access is required.');
        const sessionHash = req.authSessionId;
        if (adminAccessMode === 'private-gateway' && path !== '/api/admin/access') requireAdminNetwork(req);
        else if (adminAccessMode !== 'private-gateway') {
          const owner = db.prepare('SELECT u.email,a.emailVerified FROM users u JOIN auth_users a ON a.id=u.id WHERE u.id=?').get(user.id);
          if (!owner?.emailVerified || owner.email !== ownerEmail) fail(403, 'ADMIN_REQUIRED', 'Owner access is required.');
        }
        if (method === 'GET' && path === '/api/admin/access') return respond(res, 200, passkeys ? passkeys.status(user.id, sessionHash) : { mode: adminAccessMode });
        if (passkeys) {
          if (method === 'POST' && path === '/api/admin/lock') { passkeys.lock(user.id, sessionHash); return respond(res, 204); }
          if (method === 'POST' && path.startsWith('/api/admin/passkey/')) {
            limitAuth(req);
            const body = await readJson(req, 32768);
            await userFrom(req);
            if (path === '/api/admin/passkey/register-options') return respond(res, 200, await passkeys.registrationOptions(user.id, sessionHash, origin, body));
            if (path === '/api/admin/passkey/register') return respond(res, 200, await passkeys.register(user.id, sessionHash, origin, body.response));
            if (path === '/api/admin/passkey/authenticate-options') return respond(res, 200, await passkeys.authenticationOptions(user.id, sessionHash, origin));
            if (path === '/api/admin/passkey/authenticate') return respond(res, 200, await passkeys.authenticate(user.id, sessionHash, origin, body.response));
            fail(404, 'NOT_FOUND', 'Endpoint not found.');
          }
          if (path === '/api/admin/step-up') fail(403, 'ADMIN_PASSKEY_REQUIRED', 'Approve with your iPhone passkey to open owner tools.');
          passkeys.assertElevated(user.id, sessionHash);
        }
        if (method === 'POST' && path === '/api/admin/lock') {
          db.prepare('DELETE FROM admin_stepups WHERE session_hash = ? AND user_id = ?').run(sessionHash, user.id);
          return respond(res, 204);
        }
        if (method === 'POST' && path === '/api/admin/step-up') {
          limitAuth(req);
          const body = await readJson(req, Math.min(maxBodyBytes, 8192));
          await userFrom(req);
          if (typeof body.password !== 'string' || body.password.length < 12 || Buffer.byteLength(body.password) > 1024) fail(401, 'INVALID_CREDENTIALS', 'Password or verification code is incorrect.');
          const row=db.prepare("SELECT password FROM auth_accounts WHERE userId=? AND providerId='credential'").get(user.id);
          if(!row||!await verifyCredential({password:body.password,hash:row.password}))fail(401,'INVALID_CREDENTIALS','Password or verification code is incorrect.');
          return respond(res, 200, coupons.adminStepUp(user.id, sessionHash, body.totp));
        }
        if(method==='GET'&&path==='/api/admin/overview')return respond(res,200,ownerOperations.overview(user.id,sessionHash));
        if(method==='POST'&&path==='/api/admin/receipt-scans/reconcile'){
          coupons.assertAdmin(user.id,sessionHash);const jobs=receiptScans.chargeJobs();
          release();release=undefined;const charges=await Promise.all(jobs.map(job=>receiptScans.lookupCharge(job)));release=await acquire();
          const report=receiptScans.applyCharges(charges);await userFrom(req);coupons.assertAdmin(user.id,sessionHash);
          if(passkeys)passkeys.assertElevated(user.id,sessionHash);
          return respond(res,200,report);
        }
        if(method==='GET'&&path==='/api/admin/receipt-scans'){coupons.assertAdmin(user.id,sessionHash);return respond(res,200,receiptScans.report());}
        if(method==='GET'&&path==='/api/admin/customers'){
          const query=new URL(req.url,'http://api.invalid').searchParams;
          return respond(res,200,ownerOperations.customers(user.id,sessionHash,query.get('q')??'',query.get('access')??'all',Number(query.get('page')??0)));
        }
        const customerPath=/^\/api\/admin\/customers\/([0-9a-f-]{36})$/.exec(path);
        if(method==='GET'&&customerPath)return respond(res,200,ownerOperations.customer(user.id,sessionHash,customerPath[1]));
        const resetPath=/^\/api\/admin\/customers\/([0-9a-f-]{36})\/budget-reset$/.exec(path);
        if(method==='GET'&&resetPath)return respond(res,200,accountReset.preview(user.id,sessionHash,resetPath[1]));
        if(method==='POST'&&resetPath){
          const body=await readJson(req,4096);await userFrom(req);
          return respond(res,200,accountReset.request(user.id,sessionHash,resetPath[1],body));
        }
        const cancelResetPath=/^\/api\/admin\/customers\/([0-9a-f-]{36})\/budget-reset\/cancel$/.exec(path);
        if(method==='POST'&&cancelResetPath){
          const body=await readJson(req,2048);await userFrom(req);
          return respond(res,200,accountReset.cancelByOwner(user.id,sessionHash,cancelResetPath[1],body));
        }
        if(method==='POST'&&path==='/api/admin/access-grants'){
          const body=await readJson(req,8192);await userFrom(req);
          return respond(res,200,coupons.grantAccess(user.id,body,sessionHash));
        }
        if(path==='/api/admin/billing-history'||path.startsWith('/api/admin/billing-history/')){
          coupons.assertAdmin(user.id,sessionHash);
          if(method==='GET'&&path==='/api/admin/billing-history')return respond(res,200,billingHistory.overview(user.id,new URL(req.url,'http://api.invalid').searchParams.get('user')??''));
          const body=await readJson(req,8192);await userFrom(req);coupons.assertAdmin(user.id,sessionHash);
          if(method==='POST'&&path.endsWith('/reports'))return respond(res,200,billingHistory.report(user.id,body.paymentId,body.operationId));
          if(method==='POST'&&path.endsWith('/review'))return respond(res,200,billingHistory.review(user.id,body));
          fail(404,'NOT_FOUND','Endpoint not found.');
        }
        if(method==='GET'&&path==='/api/admin/onboarding-feedback'){coupons.assertAdmin(user.id,sessionHash);return respond(res,200,onboarding.feedbackReport());}
        if(method==='GET'&&path==='/api/admin/onboarding'){
          coupons.assertAdmin(user.id,sessionHash);
          const query=new URL(req.url,'http://api.invalid').searchParams;
          if([...query.keys()].some(key=>!['days','cohort','experience','inactiveDays'].includes(key)))fail(400,'INVALID_FUNNEL_FILTER','Choose only supported aggregate filters.');
          return respond(res,200,onboarding.aggregate({days:Number(query.get('days')??30),cohort:query.get('cohort')??'new',experience:query.get('experience')??'all',inactiveDays:Number(query.get('inactiveDays')??1)}));
        }
        if (method === 'GET' && path === '/api/admin/coupons') return respond(res, 200, { coupons: coupons.listCoupons(user.id, sessionHash), monthlyOffers:coupons.availableMonthlyOffers(user.id,sessionHash) });
        if (method === 'POST' && path === '/api/admin/coupons') {
          const body = await readJson(req, Math.min(maxBodyBytes, 8192));
          await userFrom(req);
          return respond(res, 201, coupons.createCoupon(user.id, body, sessionHash));
        }
        const couponAction=/^\/api\/admin\/coupons\/([0-9a-f-]{36})\/(active|monthly-offer)$/.exec(path);
        if(method==='POST'&&couponAction){const body=await readJson(req,8192);await userFrom(req);return respond(res,200,couponAction[2]==='active'?coupons.setCouponActive(user.id,couponAction[1],body,sessionHash):coupons.connectMonthlyOffer(user.id,couponAction[1],body,sessionHash));}
        const revoke = /^\/api\/admin\/coupons\/([0-9a-f-]{36})\/revoke$/.exec(path);
        if (method === 'POST' && revoke) return respond(res, 200, coupons.revokeCoupon(user.id, revoke[1], sessionHash));
        if (method === 'GET' && path === '/api/admin/usage') {
          const lookup = new URL(req.url, 'http://api.invalid').searchParams.get('user');
          return respond(res, 200, coupons.lookupUsage(user.id, lookup, sessionHash));
        }
        if (method === 'GET' && path === '/api/admin/audit') return respond(res, 200, { events: coupons.audit(user.id, sessionHash) });
        fail(404, 'NOT_FOUND', 'Endpoint not found.');
      }
      if (path === '/api/budgets' && method === 'GET') {
        const budgets = db.prepare('SELECT id, name, revision, updated_at FROM budgets WHERE owner_id = ? ORDER BY updated_at DESC, id').all(user.id).map(row => ({ id: row.id, name: row.name, revision: row.revision, updatedAt: new Date(row.updated_at).toISOString() }));
        return respond(res, 200, { budgets });
      }
      if (path === '/api/budgets' && method === 'POST') {
        const body = await readJson(req, maxBodyBytes);
        await userFrom(req);
        const budget = reviewedBudget(body);
        if (body.mutationId !== undefined && (typeof body.mutationId !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(body.mutationId))) fail(400, 'MUTATION_REQUIRED', 'Use a unique mutationId of 16 to 128 letters, digits, hyphens, or underscores.');
        accountReset.assertCreation(user.id,body.mutationId);
        if(body.serviceAction!==undefined&&body.serviceAction!=='budget.saved')fail(400,'INVALID_ACTION','Unsupported creation action.');
        if(body.completeSetup!==undefined&&typeof body.completeSetup!=='boolean')fail(400,'INVALID_SETUP','Choose a valid setup completion value.');
        const plannedShares=body.plannedShares===undefined?undefined:sharedExpenses.people.validatePlans(budget,body.plannedShares);
        const document = JSON.stringify(budget), requestSource=body.completeSetup?JSON.stringify([document,body.serviceAction??null,true]):body.serviceAction?JSON.stringify([document,body.serviceAction]):document;
        const requestHash=digest(plannedShares===undefined?requestSource:JSON.stringify([requestSource,plannedShares]));
        if(body.completeSetup)onboarding.get(user.id);
        let resultBody;
        db.exec('BEGIN IMMEDIATE');
        try {
          operations.assertOpen(user.id,'budget-create','',body.mutationId);
          const previous = body.mutationId && db.prepare('SELECT request_hash, budget_id FROM budget_creations WHERE user_id = ? AND mutation_id = ?').get(user.id, body.mutationId);
          if (previous) {
            if (previous.request_hash !== requestHash) fail(409, 'MUTATION_REUSED', 'This creation ID was already used for a different budget.');
            resultBody = { ...snapshot(db.prepare('SELECT * FROM budgets WHERE id = ? AND owner_id = ?').get(previous.budget_id, user.id)), replayed: true };
          } else {
            billing.requireEditing(user.id);
            const limits = coupons.usage(user.id);
            if (limits.budgetCount >= limits.budgetLimit) fail(409, 'BUDGET_LIMIT', `This account has reached its ${limits.budgetLimit}-budget limit.`);
            const id = randomUUID(), now = Date.now();
            db.prepare('INSERT INTO budgets(id, owner_id, name, document, revision, updated_at) VALUES (?, ?, ?, ?, 1, ?)').run(id, user.id, budget.name, document, now);
            if (body.mutationId) db.prepare('INSERT INTO budget_creations(user_id, mutation_id, request_hash, budget_id) VALUES (?, ?, ?, ?)').run(user.id, body.mutationId, requestHash, id);
            const plans=sharedExpenses.people.updatePlans(user.id,id,budget,plannedShares);
            resultBody = { id, revision: 1, updatedAt: new Date(now).toISOString(), budget,subscriptionVersion:1,plannedShares:plans };
          }
          if(!resultBody.replayed){onboarding.syncBudget(user.id,resultBody.id,budget);if(body.serviceAction){billingHistory.record(user.id,'budget.saved',body.mutationId??resultBody.id);if(body.serviceAction==='import.completed')billingHistory.record(user.id,'import.completed',body.mutationId??resultBody.id);}}
          if(body.completeSetup)onboarding.completeSetup(user.id,resultBody.id,budget);
          operations.record(user.id,'budget-create','',body.mutationId,resultBody);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        if(!resultBody.replayed)emailPreferences.recordSpend(user.id,null,budget);
        return respond(res, resultBody.replayed ? 200 : 201, resultBody);
      }
      const changesMatch = /^\/api\/budgets\/([0-9a-f-]{36})\/changes$/.exec(path);
      if (changesMatch && method === 'GET') {
        const afterText = new URL(req.url, 'http://localhost').searchParams.get('after');
        const after = Number(afterText);
        if (!afterText || !/^[1-9]\d*$/.test(afterText) || !Number.isSafeInteger(after)) fail(400, 'INVALID_REVISION', 'Provide the last saved revision.');
        const readRevision = () => db.prepare('SELECT revision FROM budgets WHERE id=? AND owner_id=?').get(changesMatch[1], user.id)?.revision;
        let currentRevision = readRevision();
        if (!currentRevision) fail(404, 'NOT_FOUND', 'Budget not found.');
        if (after === currentRevision) {
          const controller = new AbortController();
          const closed = () => controller.abort();
          res.once('close', closed);
          // Register before releasing the queue so a save cannot be missed.
          const waiting = budgetChanges.wait(user.id, changesMatch[1], controller.signal);
          release(); release = undefined;
          const reason = await waiting;
          res.off('close', closed);
          if (res.destroyed) return;
          release = await acquire();
          await userFrom(req);
          if (reason === 'busy') fail(429, 'SYNC_BUSY', 'Live updates are busy. Try again shortly.');
          currentRevision = readRevision();
          if (!currentRevision) fail(404, 'NOT_FOUND', 'Budget not found.');
        }
        return respond(res, 200, { revision: currentRevision, changed: currentRevision !== after });
      }
      const exported = /^\/api\/budgets\/([0-9a-f-]{36})\/export$/.exec(path);
      if(exported&&method==='POST'){
        const body=await readJson(req,8192);if(!operationId(body.operationId))fail(400,'OPERATION_REQUIRED','Use a unique export operation ID.');
        const row=db.prepare('SELECT * FROM budgets WHERE id=? AND owner_id=?').get(exported[1],user.id);
        if(!row)fail(404,'NOT_FOUND','Budget not found.');
        const data=snapshot(row);billingHistory.record(user.id,'export.prepared',body.operationId);return respond(res,200,data);
      }
      const match = /^\/api\/budgets\/([0-9a-f-]{36})$/.exec(path);
      if (match && ['GET', 'PUT'].includes(method)) {
        const row = db.prepare('SELECT * FROM budgets WHERE id = ? AND owner_id = ?').get(match[1], user.id);
        if (!row) fail(404, 'NOT_FOUND', 'Budget not found.');
        if (method === 'GET') return respond(res, 200, snapshot(row));
        const body = await readJson(req, maxBodyBytes);
        await userFrom(req);
        if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) fail(400, 'REVISION_REQUIRED', 'Include the last revision you downloaded.');
        if (typeof body.mutationId !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(body.mutationId)) fail(400, 'MUTATION_REQUIRED', 'Include a unique mutationId of 16 to 128 letters, digits, hyphens, or underscores.');
        let budget = reviewedBudget(body);
        const now = Date.now();
        if(body.serviceAction!==undefined&&!['budget.saved','import.completed'].includes(body.serviceAction))fail(400,'INVALID_ACTION','Unsupported service action.');
        if(body.serviceAction==='import.completed'){const existing=new Set(JSON.parse(row.document).entries.map(e=>e.id));if(!budget.entries.some(e=>!existing.has(e.id)&&e.importKey)&&!db.prepare('SELECT 1 FROM budget_mutations WHERE budget_id=? AND mutation_id=?').get(match[1],body.mutationId))fail(400,'INVALID_IMPORT','No completed import was found in this save.');}
        const plannedShares=body.plannedShares===undefined?undefined:sharedExpenses.people.validatePlans(budget,body.plannedShares);
        const requestSource=JSON.stringify(body.serviceAction?[body.expectedRevision,budget,body.serviceAction]:[body.expectedRevision,budget]);
        const requestHash=digest(plannedShares===undefined?requestSource:JSON.stringify([requestSource,plannedShares]));
        let resultBody;
        db.exec('BEGIN IMMEDIATE');
        try {
          operations.assertOpen(user.id,'budget-update',match[1],body.mutationId);
          const previous = db.prepare('SELECT request_hash, response FROM budget_mutations WHERE budget_id = ? AND mutation_id = ?').get(match[1], body.mutationId);
          if (previous) {
            if (previous.request_hash !== requestHash) fail(409, 'MUTATION_REUSED', 'This mutation ID was already used for a different change.');
            const {retainedSubscriptions,...receipt}=JSON.parse(previous.response);
            budget=applySubscriptionFlags(budget,retainedSubscriptions);
            resultBody = { ...receipt, budget, subscriptionVersion:1, plannedShares:plannedShares??sharedExpenses.people.plans(user.id,match[1]), replayed: true };
          } else {
            billing.requireEditing(user.id);
            const savedBudget=validateBudget(JSON.parse(row.document));
            const retainedSubscriptions=retainedSubscriptionFlags(savedBudget,budget);
            budget=applySubscriptionFlags(budget,retainedSubscriptions);
            const document=JSON.stringify(budget);
            sharedExpenses.assertBudgetChange(user.id,match[1],savedBudget,budget);
            const plans=sharedExpenses.people.updatePlans(user.id,match[1],budget,plannedShares);
            const result = db.prepare('UPDATE budgets SET name = ?, document = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND owner_id = ? AND revision = ?').run(budget.name, document, now, match[1], user.id, body.expectedRevision);
            if (!result.changes) {
              const current = db.prepare('SELECT revision FROM budgets WHERE id = ? AND owner_id = ?').get(match[1], user.id);
              fail(409, 'REVISION_CONFLICT', 'This budget changed on another device. Download the latest version before saving.', { currentRevision: current.revision });
            }
            resultBody = { id: match[1], revision: body.expectedRevision + 1, updatedAt: new Date(now).toISOString(), budget,subscriptionVersion:1,plannedShares:plans };
            const receipt = { id: resultBody.id, revision: resultBody.revision, updatedAt: resultBody.updatedAt,...(retainedSubscriptions.length?{retainedSubscriptions}:{}) };
            db.prepare('INSERT INTO budget_mutations (budget_id, mutation_id, request_hash, response, revision) VALUES (?, ?, ?, ?, ?)').run(match[1], body.mutationId, requestHash, JSON.stringify(receipt), resultBody.revision);
            db.prepare('DELETE FROM budget_mutations WHERE budget_id = ? AND revision <= ?').run(match[1], resultBody.revision - 100);
          }
          if(!resultBody.replayed){onboarding.syncBudget(user.id,resultBody.id,budget);if(body.serviceAction){billingHistory.record(user.id,'budget.saved',body.mutationId??resultBody.id);if(body.serviceAction==='import.completed')billingHistory.record(user.id,'import.completed',body.mutationId??resultBody.id);}}
          operations.record(user.id,'budget-update',match[1],body.mutationId,resultBody);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        if(!resultBody.replayed){budgetChanges.publish(user.id,resultBody.id);emailPreferences.recordSpend(user.id,JSON.parse(row.document),budget);}
        return respond(res, 200, resultBody);
      }
      fail(404, 'NOT_FOUND', 'Endpoint not found.');
    } catch (error) {
      if (!res.destroyed && !res.writableEnded) {
        const known = services.isError(error) || error instanceof OperationStatusError || error instanceof NotificationError || error instanceof ApiError || error instanceof ScanError || error instanceof SharedExpenseError || error instanceof NativeAuthError || error instanceof OnboardingError;
        if (known && error.status === 429) res.setHeader('Retry-After', String(Math.ceil(authWindowMs / 1000)));
        respond(res, known ? error.status : 500, { error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'The request could not be completed.' }, ...(known ? error.details : {}) });
      }
    } finally {release?.();}
  });
  server.keepAliveTimeout = 5000;
  return {
    server,
    async listen(port = 8787, host = '127.0.0.1') {
      await authentication.ready;
      onboarding=createOnboardingService(db);
      emailPreferences=createEmailPreferences(db,{mailer,origin:allowedOrigins[0],postalAddress:emailOptions.postalAddress??'',welcomeSince:emailOptions.welcomeSince??0,withLock:async callback=>{const release=await acquire();try{return callback();}finally{release();}}});
      erasure.replay();
      sharedExpenses.people.migrate();
      notificationTimer=setInterval(runNotifications,5000);notificationTimer.unref();
      if(mode==='cloud'){historyTimer=setInterval(runHistory,60000);historyTimer.unref();runHistory();}
      if(mailer.available){emailTimer=setInterval(runEmails,60000);emailTimer.unref();}
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.off('error', reject); resolve(server.address()); });
      });
    },
    async close() {
      clearInterval(notificationTimer); await notificationTick;
      clearInterval(receiptRetentionTimer);
      budgetChanges.close();
      clearInterval(nativeAuthTimer); nativeAuth.close();
      clearInterval(historyTimer);await historyTick;
      clearInterval(emailTimer);await emailTick;
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await authentication.ready.catch(()=>{});
      await mailer.drain();
      db.close();
    },
  };
}
