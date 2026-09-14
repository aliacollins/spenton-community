import { createHash, randomBytes } from 'node:crypto';
import { emailTemplate } from './email-templates.mjs';
const DAY=86400000, hash=value=>createHash('sha256').update(value).digest('hex');
export function createEmailPreferences(db,{mailer,origin,postalAddress='',welcomeSince=0,now=Date.now,withLock=async callback=>callback()}){
 db.exec(`CREATE TABLE IF NOT EXISTS email_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,mode TEXT NOT NULL DEFAULT 'off',timezone TEXT NOT NULL DEFAULT 'UTC',hour INTEGER NOT NULL DEFAULT 19,consented_at INTEGER,updated_at INTEGER NOT NULL,unsubscribe_hash TEXT UNIQUE) STRICT;
 CREATE TABLE IF NOT EXISTS email_activity(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,joined_at INTEGER NOT NULL,last_spend_at INTEGER,welcome_done INTEGER NOT NULL DEFAULT 0) STRICT;
 CREATE TABLE IF NOT EXISTS email_deliveries(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,day TEXT NOT NULL,sent_at INTEGER NOT NULL,PRIMARY KEY(user_id,kind,day)) STRICT;
 CREATE TABLE IF NOT EXISTS email_unsubscribes(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL) STRICT;
 CREATE TRIGGER IF NOT EXISTS email_new_account AFTER INSERT ON auth_users BEGIN INSERT INTO email_activity(user_id,joined_at) VALUES(NEW.id,CAST(unixepoch('now','subsec')*1000 AS INTEGER)); END;`);
 const available=!!mailer.remindersAvailable&&!!postalAddress;
 function get(userId){const row=db.prepare('SELECT mode,timezone,hour,consented_at,updated_at FROM email_preferences WHERE user_id=?').get(userId);return {...(row??{mode:'off',timezone:'UTC',hour:19,consented_at:null,updated_at:null}),available};}
 function save(userId,{mode,timezone,hour}){
  if(!['off','daily','gentle'].includes(mode)||typeof timezone!=='string'||timezone.length>100||!Number.isInteger(hour)||hour<0||hour>23)throw new Error('Choose a valid reminder schedule.');
  try{new Intl.DateTimeFormat('en',{timeZone:timezone}).format();}catch{throw new Error('Choose a valid time zone.');}
  if(mode!=='off'&&!available)throw new Error('Reminder emails are still being set up.');
  if(mode!=='off'&&!db.prepare('SELECT 1 FROM auth_users WHERE id=? AND emailVerified=1').get(userId))throw new Error('Verify your email before enabling reminders.');
  const time=now();db.prepare(`INSERT INTO email_preferences(user_id,mode,timezone,hour,consented_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET mode=excluded.mode,timezone=excluded.timezone,hour=excluded.hour,consented_at=excluded.consented_at,updated_at=excluded.updated_at,unsubscribe_hash=NULL`).run(userId,mode,timezone,hour,mode==='off'?null:time,time);
  db.prepare('DELETE FROM email_unsubscribes WHERE user_id=?').run(userId);return get(userId);
 }
 function unsubscribe(token){if(typeof token!=='string'||token.length!==43)return;db.prepare("UPDATE email_preferences SET mode='off',consented_at=NULL,updated_at=? WHERE user_id IN (SELECT user_id FROM email_unsubscribes WHERE token_hash=? AND expires_at>?)").run(now(),hash(token),now());}
 function recordSpend(userId,before,after){const ids=new Set((before?.entries??[]).map(e=>e.id));if((after.entries??[]).some(e=>e.kind==='expense'&&!ids.has(e.id)))db.prepare('INSERT INTO email_activity(user_id,joined_at,last_spend_at,welcome_done) VALUES(?,?,?,1) ON CONFLICT(user_id) DO UPDATE SET last_spend_at=excluded.last_spend_at').run(userId,now(),now());}
 async function tick(){
  const time=now();
  const jobs=await withLock(()=>{
   db.prepare('DELETE FROM email_unsubscribes WHERE expires_at<=?').run(time);db.prepare('DELETE FROM email_deliveries WHERE sent_at<?').run(time-40*DAY);
   const result=[];
   if(mailer.available&&(mailer.welcomeAvailable??true))for(const user of db.prepare('SELECT a.user_id FROM email_activity a JOIN auth_users u ON u.id=a.user_id WHERE a.welcome_done=0 AND u.emailVerified=1 AND a.joined_at>? LIMIT 25').all(Math.max(time-DAY,welcomeSince)))result.push({userId:user.user_id,kind:'welcome'});
   if(available)for(const row of db.prepare("SELECT p.*,a.last_spend_at FROM email_preferences p JOIN auth_users u ON u.id=p.user_id LEFT JOIN email_activity a ON a.user_id=p.user_id WHERE p.mode!='off' AND u.emailVerified=1").all()){
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:row.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(time).map(p=>[p.type,p.value]));
    if(Number(parts.hour)!==row.hour)continue;
    const day=parts.year+'-'+parts.month+'-'+parts.day;
    const last=db.prepare('SELECT max(sent_at) AS time FROM email_deliveries WHERE user_id=?').get(row.user_id)?.time??0;
    if(time-last<(row.mode==='gentle'?7*DAY:20*3600000))continue;
    if(row.mode==='gentle'&&time-Math.max(row.last_spend_at??0,row.consented_at??time)<3*DAY)continue;
    if(db.prepare('SELECT 1 FROM email_deliveries WHERE user_id=? AND kind=? AND day=?').get(row.user_id,row.mode,day))continue;
    result.push({userId:row.user_id,kind:row.mode,day,updated:row.updated_at});if(result.length>=50)break;
   }
   return result;
  });
  for(const job of jobs){
   const message=await withLock(()=>{
    const user=db.prepare('SELECT email FROM auth_users WHERE id=? AND emailVerified=1').get(job.userId);if(!user)return null;
    if(job.kind==='welcome')return {id:'welcome-'+job.userId,channel:'welcome',to:user.email,...emailTemplate('welcome',{url:origin+'/',origin})};
    const current=db.prepare('SELECT mode,updated_at FROM email_preferences WHERE user_id=?').get(job.userId);if(current?.mode!==job.kind||current.updated_at!==job.updated)return null;
    const claimed=db.prepare('INSERT OR IGNORE INTO email_deliveries(user_id,kind,day,sent_at) VALUES(?,?,?,?)').run(job.userId,job.kind,job.day,time);if(!claimed.changes)return null;
    const token=randomBytes(32).toString('base64url');db.prepare('INSERT INTO email_unsubscribes(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hash(token),job.userId,time+365*DAY);
    const unsubscribeUrl=origin+'/?account-action=unsubscribe#token='+token;
    return {id:'reminder-'+job.userId+'-'+job.kind+'-'+job.day,channel:'reminder',to:user.email,headers:{'List-Unsubscribe':'<'+origin+'/api/email/one-click?token='+token+'>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click'},...emailTemplate(job.kind,{url:origin+'/',origin,unsubscribeUrl,postalAddress})};
   });
   if(!message)continue;
   // Network delivery never holds the API's database writer lock.
   try{await mailer.deliver(message);if(job.kind==='welcome')await withLock(()=>db.prepare('UPDATE email_activity SET welcome_done=1 WHERE user_id=?').run(job.userId));}catch{}
  }
 }

 return {get,save,unsubscribe,recordSpend,tick};
}
