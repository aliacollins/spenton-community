import { betterAuth } from 'better-auth';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { getMigrations } from 'better-auth/db/migration';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { chmodSync } from 'node:fs';
import { emailTemplate } from './email-templates.mjs';
import { PROVIDERS, socialConfiguration } from './social-auth.mjs';

const derive=promisify(scrypt);
const developmentSecret=randomBytes(48).toString('base64url');
const LEGACY=/^legacy\$([a-f0-9]{32})\$([a-f0-9]{128})$/;

// Legacy passwords used raw UTF-8 and a binary salt. Better Auth's default
// encoding/normalization is different, so verify these hashes explicitly.
export async function verifyCredential({password,hash}){
 const legacy=LEGACY.exec(hash);
 if(!legacy)return verifyPassword({password,hash});
 const actual=await derive(password,Buffer.from(legacy[1],'hex'),64,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 return timingSafeEqual(actual,Buffer.from(legacy[2],'hex'));
}

export function createAuthentication(db,{dbPath,origins,secureCookies,allowRegistration,sessionTtlMs,authSecret,socialEnv,mailer,requireEmailVerification=false}){
 const secret=authSecret??process.env.BETTER_AUTH_SECRET??(process.env.NODE_ENV==='production'?undefined:developmentSecret);
 if(typeof secret!=='string'||secret.length<32)throw new Error('A persistent BETTER_AUTH_SECRET of at least 32 characters is required.');
 const socialProviders=socialConfiguration(socialEnv,{allowRegistration,secureCookies});
 db.exec('CREATE TABLE IF NOT EXISTS account_links (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,email TEXT NOT NULL,kind TEXT NOT NULL,expires_at INTEGER NOT NULL,protected_token TEXT,UNIQUE(user_id,kind)) STRICT;');
 if(!db.prepare('PRAGMA table_info(account_links)').all().some(column=>column.name==='protected_token'))db.exec('ALTER TABLE account_links ADD COLUMN protected_token TEXT');
 const emailKey=createHash('sha256').update('spenton:account-links:'+secret).digest();
 const emailToken=link=>{const [iv,tag,ciphertext]=link.protected_token.split('.').map(part=>Buffer.from(part,'base64url'));const decipher=createDecipheriv('aes-256-gcm',emailKey,iv);decipher.setAAD(Buffer.from(link.user_id+':'+link.kind));decipher.setAuthTag(tag);return Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString('utf8');};
 const emailLink=(kind,seconds)=>({user,token:nativeToken})=>{
  const token=randomBytes(32).toString('base64url'),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',emailKey,iv);cipher.setAAD(Buffer.from(user.id+':'+kind));
  const ciphertext=Buffer.concat([cipher.update(nativeToken,'utf8'),cipher.final()]),protectedToken=[iv,cipher.getAuthTag(),ciphertext].map(part=>part.toString('base64url')).join('.');
  const now=Date.now(),tokenHash=createHash('sha256').update(token).digest('hex');
  db.prepare('DELETE FROM account_links WHERE expires_at<=? OR (user_id=? AND kind=?)').run(now,user.id,kind);
  db.prepare('INSERT INTO account_links(token_hash,user_id,email,kind,expires_at,protected_token) VALUES(?,?,?,?,?,?)').run(tokenHash,user.id,user.email,kind,now+seconds*1000,protectedToken);
  const url=origins[0]+'/?account-action='+kind+'#token='+encodeURIComponent(token);
  mailer.send({id:randomUUID(),to:user.email,...emailTemplate(kind,{url,origin:origins[0]})});
 };
 const auth=betterAuth({
  appName:'SpentOn',baseURL:origins[0],basePath:'/api/auth',secret,
  trustedOrigins:[...origins,...(socialProviders.apple?['https://appleid.apple.com']:[])],socialProviders,database:db,logger:{disabled:true},
  emailAndPassword:{enabled:true,disableSignUp:!allowRegistration,minPasswordLength:12,maxPasswordLength:1024,requireEmailVerification,revokeSessionsOnPasswordReset:true,resetPasswordTokenExpiresIn:1800,...(mailer?.available?{sendResetPassword:emailLink('reset',1800),onPasswordReset:({user})=>mailer.send({id:randomUUID(),to:user.email,...emailTemplate('changed',{url:origins[0]+'/',origin:origins[0]})})}:{}),password:{hash:hashPassword,verify:verifyCredential}},
  emailVerification:{sendOnSignUp:requireEmailVerification,sendOnSignIn:false,autoSignInAfterVerification:false,expiresIn:3600,...(mailer?.available?{sendVerificationEmail:emailLink('verify',3600)}:{})},
  user:{modelName:'auth_users'},account:{modelName:'auth_accounts',encryptOAuthTokens:true,accountLinking:{enabled:true,disableImplicitLinking:true,allowDifferentEmails:false,trustedProviders:[]}},verification:{modelName:'auth_verifications',storeIdentifier:{default:'plain',overrides:{'reset-password':'hashed'}}},
  session:{modelName:'auth_sessions',expiresIn:sessionTtlMs/1000,disableSessionRefresh:true,cookieCache:{enabled:false}},
  advanced:{useSecureCookies:secureCookies,cookiePrefix:'spenton',cookies:{state:{attributes:{sameSite:secureCookies?'none':'lax',secure:secureCookies}},oauth_state:{attributes:{sameSite:secureCookies?'none':'lax',secure:secureCookies}}},defaultCookieAttributes:{httpOnly:true,sameSite:'strict',path:'/api'},database:{generateId:()=>randomUUID()}},
  // The app's HTTP boundary applies exact origin checks and bounded IP throttles
  // to every exposed auth route. No unrestricted Better Auth handler is mounted.
  rateLimit:{enabled:false},
 });
 const ready=(async()=>{
  const legacy=db.prepare('SELECT id,email,salt,password_hash,created_at FROM users WHERE length(password_hash)>0').all();
  const migrated=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='auth_migrations'").get();
  if(!migrated&&legacy.length&&dbPath!==':memory:'){
   const backup=dbPath+'.before-better-auth-'+Date.now()+'.sqlite';
   db.exec("VACUUM INTO '"+backup.replaceAll("'","''")+"'");chmodSync(backup,0o600);
  }
  const migration=await getMigrations(auth.options);
  await migration.runMigrations();
  db.exec('BEGIN IMMEDIATE');
  try{
   db.exec(`CREATE TABLE IF NOT EXISTS auth_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT;`);
   if(!db.prepare('SELECT 1 FROM auth_migrations WHERE version=1').get()){
    const oldElevation=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='admin_stepups'").get();
    if(oldElevation?.sql.includes('REFERENCES sessions'))db.exec('DROP TABLE admin_stepups');
    for(const user of legacy){
     if(!/^[a-f0-9]{32}$/.test(user.salt)||!/^[a-f0-9]{128}$/.test(user.password_hash))throw new Error('An existing password cannot be migrated.');
     const date=new Date(user.created_at).toISOString();
     db.prepare('INSERT INTO auth_users(id,name,email,emailVerified,image,createdAt,updatedAt) VALUES(?,?,?,0,NULL,?,?)').run(user.id,user.email.split('@')[0],user.email,date,date);
     db.prepare('INSERT INTO auth_accounts(id,userId,accountId,providerId,password,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),user.id,user.id,'credential','legacy$'+user.salt+'$'+user.password_hash,date,date);
    }
    db.exec("DELETE FROM sessions; UPDATE users SET salt='',password_hash='';");
    db.prepare('INSERT INTO auth_migrations(version,applied_at) VALUES(1,?)').run(Date.now());
   }
   // Keep application ownership and trial timestamps tied to the same immutable
   // user ID. Triggers participate in Better Auth's signup transaction.
   db.exec(`
    CREATE TABLE IF NOT EXISTS auth_signin_preferences (user_id TEXT PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,method TEXT NOT NULL CHECK(method IN ('password','google','microsoft','apple')),updated_at INTEGER NOT NULL) STRICT;
    CREATE TRIGGER IF NOT EXISTS auth_profile_insert AFTER INSERT ON auth_users BEGIN
     INSERT INTO users(id,email,salt,password_hash,created_at) VALUES(NEW.id,NEW.email,'','',CAST(unixepoch(NEW.createdAt,'subsec')*1000 AS INTEGER));
    END;
    CREATE TRIGGER IF NOT EXISTS auth_profile_email AFTER UPDATE OF email ON auth_users BEGIN
     UPDATE users SET email=NEW.email WHERE id=NEW.id;
    END;
    CREATE TABLE IF NOT EXISTS admin_stepups (
     session_hash TEXT PRIMARY KEY REFERENCES auth_sessions(id) ON DELETE CASCADE,
     user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE TRIGGER IF NOT EXISTS auth_session_limit AFTER INSERT ON auth_sessions BEGIN
     DELETE FROM auth_sessions WHERE userId=NEW.userId AND id NOT IN
      (SELECT id FROM auth_sessions WHERE userId=NEW.userId ORDER BY createdAt DESC,rowid DESC LIMIT 10);
    END;
   `);
   if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('Authentication migration failed ownership validation.');
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
 })();
 const lastSignInMethod=userId=>db.prepare('SELECT method FROM auth_signin_preferences WHERE user_id=?').get(userId)?.method??null;
 const recordSignIn=(userId,method)=>{if(!['password','google','microsoft','apple'].includes(method))throw new Error('Unknown sign-in method.');db.prepare('INSERT INTO auth_signin_preferences(user_id,method,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET method=excluded.method,updated_at=excluded.updated_at').run(userId,method,Date.now());};
 return {auth,ready,emailToken,lastSignInMethod,recordSignIn,providers:PROVIDERS.map(([id,name])=>({id,name,available:!!socialProviders[id]}))};
}

export function authHeaders(req){
 const headers=new Headers();
 for(const name of ['cookie','origin','user-agent'])if(typeof req.headers[name]==='string')headers.set(name,req.headers[name]);
 return headers;
}
