import {hashPassword} from 'better-auth/crypto';

// These identifiers belong only to this installation, never to an external mailbox.
export const LOCAL_ACCOUNT_DOMAIN='local.spenton.invalid';
export function localAccountEmail(username){
 if(typeof username!=='string'||!/^[a-z0-9][a-z0-9._-]{2,39}$/i.test(username.trim()))throw new Error('Use 3–40 letters, numbers, dots, underscores or hyphens for your username.');
 return username.trim().toLowerCase()+'@'+LOCAL_ACCOUNT_DOMAIN;
}
export function localUsername(email){return email?.endsWith('@'+LOCAL_ACCOUNT_DOMAIN)?email.slice(0,-LOCAL_ACCOUNT_DOMAIN.length-1):null;}
export function prepareLocalAccounts(db,enabled){
 db.exec('CREATE TABLE IF NOT EXISTS instance_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;');
 const saved=db.prepare("SELECT value FROM instance_settings WHERE key='local_accounts'").get();
 if(saved&&saved.value!==String(enabled))throw new Error('Keep this installation’s original account mode.');
 if(enabled&&!saved&&db.prepare('SELECT count(*) AS n FROM users').get().n)throw new Error('Local accounts require a new installation; existing email accounts are not converted.');
 if(enabled)db.prepare("INSERT OR IGNORE INTO instance_settings VALUES('local_accounts','true')").run();
}
export async function resetLocalPassword(db,username,password){
 if(db.prepare("SELECT value FROM instance_settings WHERE key='local_accounts'").get()?.value!=='true')throw new Error('This command is only for a local-account installation.');
 if(typeof password!=='string'||password.length<12||Buffer.byteLength(password)>1024)throw new Error('Use a password of 12–1,024 bytes.');
 const email=localAccountEmail(username),user=db.prepare('SELECT id FROM auth_users WHERE email=?').get(email);
 if(!user)throw new Error('Local account not found.');
 const hash=await hashPassword(password);
 db.exec('BEGIN IMMEDIATE');
 try{
  const changed=db.prepare("UPDATE auth_accounts SET password=?,updatedAt=? WHERE userId=? AND providerId='credential'").run(hash,new Date().toISOString(),user.id);
  if(changed.changes!==1)throw new Error('Local password account not found.');
  db.prepare('DELETE FROM auth_sessions WHERE userId=?').run(user.id);
  db.prepare('DELETE FROM account_links WHERE user_id=?').run(user.id);
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
