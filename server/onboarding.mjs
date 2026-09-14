import {createHash} from 'node:crypto';

export const ONBOARDING_STEPS=['welcome','budget','plan','purchase','insights'];
const STEP_LABELS={welcome:'Started the guide',budget:'Created a budget',plan:'Planned real money',purchase:'Recorded a purchase',insights:'Reviewed Insights'};
const OPTIONAL_STEPS=new Set(['plan','purchase']);
const EVENT_KINDS=new Set(['viewed','action','blocked']);
const ERROR_KINDS=new Set(['input','connection','conflict','session','access']);
const DAY=86400000;
export class OnboardingError extends Error{constructor(status,code,message){super(message);Object.assign(this,{status,code});}}
const reject=(status,code,message)=>{throw new OnboardingError(status,code,message);};
const iso=value=>value==null?null:new Date(value).toISOString();
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function exact(body,keys){if(!object(body)||Object.keys(body).some(key=>!keys.includes(key)))reject(400,'INVALID_ONBOARDING','Only supported onboarding fields can be sent.');}
const receiptHash=body=>createHash('sha256').update(JSON.stringify(Object.keys(body).sort().map(key=>[key,body[key]]))).digest('hex');

/** Functional progress is private to its owner; measurement is separate and opt-in. */
export function createOnboardingService(db,{now=Date.now}={}){
 db.exec(`
 CREATE TABLE IF NOT EXISTS onboarding_progress (
  user_id TEXT PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,revision INTEGER NOT NULL DEFAULT 1,
  cohort TEXT NOT NULL CHECK(cohort IN ('new','existing')),
  status TEXT NOT NULL CHECK(status IN ('offered','active','paused','dismissed','completed')),
  experience TEXT NOT NULL CHECK(experience IN ('beginner','familiar')),
  budget_id TEXT REFERENCES budgets(id) ON DELETE SET NULL,
  milestones TEXT NOT NULL,skipped TEXT NOT NULL,
  analytics_consent INTEGER NOT NULL DEFAULT 0 CHECK(analytics_consent IN (0,1)),
  consented_at INTEGER,created_at INTEGER NOT NULL,started_at INTEGER,updated_at INTEGER NOT NULL,completed_at INTEGER
 ) STRICT;
 CREATE TABLE IF NOT EXISTS onboarding_events (
  id INTEGER PRIMARY KEY,user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  step TEXT NOT NULL,kind TEXT NOT NULL,reason TEXT,created_at INTEGER NOT NULL
 ) STRICT;
 CREATE INDEX IF NOT EXISTS onboarding_events_user_time ON onboarding_events(user_id,created_at);
 CREATE INDEX IF NOT EXISTS onboarding_progress_start ON onboarding_progress(started_at);
 CREATE TABLE IF NOT EXISTS onboarding_feedback (
  user_id TEXT PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  understood TEXT NOT NULL CHECK(understood IN ('yes','partly','no')),
  mutation_id TEXT NOT NULL,created_at INTEGER NOT NULL
 ) STRICT;
 CREATE TABLE IF NOT EXISTS onboarding_receipts (
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  mutation_id TEXT NOT NULL,request_hash TEXT NOT NULL,created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,mutation_id)
 ) STRICT;
 `);
 // Upgrade databases created before written feedback was added.
 if(!db.prepare('PRAGMA table_info(onboarding_feedback)').all().some(column=>column.name==='comment'))db.exec("ALTER TABLE onboarding_feedback ADD COLUMN comment TEXT NOT NULL DEFAULT ''");
 function prune(){db.prepare('DELETE FROM onboarding_events WHERE created_at<?').run(now()-90*DAY);db.prepare('DELETE FROM onboarding_receipts WHERE created_at<?').run(now()-7*DAY);}
 prune();
 const rowFor=userId=>db.prepare('SELECT * FROM onboarding_progress WHERE user_id=?').get(userId);
 const output=row=>({version:row.version,revision:row.revision,cohort:row.cohort,status:row.status,experience:row.experience,budgetId:row.budget_id,milestones:Object.fromEntries(Object.entries(JSON.parse(row.milestones)).map(([step,time])=>[step,iso(time)])),skipped:JSON.parse(row.skipped),analyticsConsent:!!row.analytics_consent,consentedAt:iso(row.consented_at),startedAt:iso(row.started_at),updatedAt:iso(row.updated_at),completedAt:iso(row.completed_at)});
 function record(row,step,kind,reason=null){
  if(!row?.analytics_consent)return;
  // Bounded per user and deduplicated across tabs, rerenders, and rapid retries.
  if(db.prepare('SELECT 1 FROM onboarding_events WHERE user_id=? AND step=? AND kind=? AND reason IS ? AND created_at>? LIMIT 1').get(row.user_id,step,kind,reason,now()-5000))return;
  db.prepare('INSERT INTO onboarding_events(user_id,step,kind,reason,created_at) VALUES(?,?,?,?,?)').run(row.user_id,step,kind,reason,now());
  db.prepare('DELETE FROM onboarding_events WHERE user_id=? AND id NOT IN (SELECT id FROM onboarding_events WHERE user_id=? ORDER BY id DESC LIMIT 1000)').run(row.user_id,row.user_id);
 }
 function syncBudget(userId,budgetId,budget){
  let row=rowFor(userId);if(!row||row.budget_id&&row.budget_id!==budgetId)return;
  if(!db.prepare('SELECT 1 FROM budgets WHERE id=? AND owner_id=?').get(budgetId,userId))return;
  const milestones=JSON.parse(row.milestones),date=new Date(now()).toISOString().slice(0,10),events=[];
  const complete=step=>{if(!milestones[step]){milestones[step]=now();events.push(step);}};
  if(budget.accounts.some(account=>account.type==='checking'||account.type==='savings'))complete('budget');
  if(budget.entries.some(entry=>entry.kind==='allocation'&&entry.date<=date&&budget.categories.some(category=>category.id===entry.to)))complete('plan');
  if(budget.entries.some(entry=>entry.kind==='expense'&&entry.date<=date))complete('purchase');
  if(events.length||!row.budget_id){
   db.prepare('UPDATE onboarding_progress SET budget_id=?,milestones=?,revision=revision+1,updated_at=? WHERE user_id=?').run(budgetId,JSON.stringify(milestones),now(),userId);
   row=rowFor(userId);for(const step of events)record(row,step,'completed');
  }
 }
 function ensure(userId){
  let row=rowFor(userId);
  if(!row){
   const existing=db.prepare('SELECT id FROM budgets WHERE owner_id=? ORDER BY updated_at,id LIMIT 1').get(userId);
   db.prepare("INSERT INTO onboarding_progress(user_id,cohort,status,experience,budget_id,milestones,skipped,created_at,updated_at) VALUES(?,?,'offered','beginner',?,'{}','[]',?,?)").run(userId,existing?'existing':'new',existing?.id??null,now(),now());
   row=rowFor(userId);
  }
  const budget=row.budget_id?db.prepare('SELECT id,document FROM budgets WHERE id=? AND owner_id=?').get(row.budget_id,userId):db.prepare('SELECT id,document FROM budgets WHERE owner_id=? ORDER BY updated_at,id LIMIT 1').get(userId);
  if(budget)syncBudget(userId,budget.id,JSON.parse(budget.document));
  return rowFor(userId);
 }
 function get(userId){prune();return output(ensure(userId));}
 function command(userId,body){
  const allowed={start:['experience','analyticsConsent'],resume:[],pause:[],dismiss:[],skip:['step'],review:[],aha:[],finish:[],consent:['enabled']};
  if(!object(body)||!Object.hasOwn(allowed,body.operation))reject(400,'INVALID_ONBOARDING','Choose a supported onboarding action.');
  exact(body,['operation','expectedRevision','mutationId',...allowed[body.operation]]);
  if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<1||typeof body.mutationId!=='string'||!/^[a-zA-Z0-9_-]{16,128}$/.test(body.mutationId))reject(400,'INVALID_ONBOARDING','Include your progress revision and a unique request ID.');
  if(body.operation==='start'&&(!['beginner','familiar'].includes(body.experience)||typeof body.analyticsConsent!=='boolean'))reject(400,'INVALID_ONBOARDING','Choose your experience and measurement preference.');
  if(body.operation==='consent'&&typeof body.enabled!=='boolean')reject(400,'INVALID_ONBOARDING','Choose whether to share setup progress.');
  if(body.operation==='skip'&&!OPTIONAL_STEPS.has(body.step))reject(400,'INVALID_ONBOARDING','Only planning and the first purchase can be left for later.');
  prune();let row=ensure(userId);const hash=receiptHash(body);
  const receipt=db.prepare('SELECT request_hash FROM onboarding_receipts WHERE user_id=? AND mutation_id=?').get(userId,body.mutationId);
  if(receipt){if(receipt.request_hash!==hash)reject(409,'ONBOARDING_REQUEST_REUSED','This request ID was already used for a different action.');return {...output(row),replayed:true};}
  if(body.expectedRevision!==row.revision)reject(409,'ONBOARDING_CONFLICT','Your setup progress changed. Refresh it and try again.');
  const milestones=JSON.parse(row.milestones),skipped=new Set(JSON.parse(row.skipped));
  let {status,experience,started_at:started,completed_at:completed,analytics_consent:consent,consented_at:consentedAt}=row;
  const step=ONBOARDING_STEPS.find(step=>!milestones[step]&&!skipped.has(step))??'insights';
  if(body.operation==='start'){
   if(status==='completed')reject(409,'ONBOARDING_COMPLETE','Your setup is already complete. You can still open the guide.');
   status='active';experience=body.experience;started??=now();milestones.welcome??=now();
   consent=Number(body.analyticsConsent);consentedAt=consent?(consentedAt??now()):null;
  }
  if(body.operation==='resume'&&status!=='completed'){status='active';started??=now();milestones.welcome??=now();}
  if(['pause','dismiss'].includes(body.operation)&&status!=='completed')status=body.operation==='pause'?'paused':'dismissed';
  if(body.operation==='skip'){
   if(status!=='active')reject(409,'ONBOARDING_NOT_ACTIVE','Resume your guide before changing a step.');
   skipped.add(body.step);
  }
  if(body.operation==='aha'){if(status!=='active')reject(409,'ONBOARDING_NOT_READY','Resume your guide first.');milestones.aha??=now();}
  if(body.operation==='review'){
   if(!milestones.budget||status!=='active')reject(409,'ONBOARDING_NOT_READY','Create a budget and resume your guide before completing this step.');
   milestones.insights??=now();
  }
  if(body.operation==='finish'){
   if(ONBOARDING_STEPS.some(step=>!milestones[step]&&!skipped.has(step)))reject(409,'ONBOARDING_NOT_READY','Complete the remaining steps or leave optional steps for later.');
   status='completed';completed??=now();
  }
  if(body.operation==='consent'){consent=Number(body.enabled);consentedAt=consent?(consentedAt??now()):null;}
  db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare('UPDATE onboarding_progress SET status=?,experience=?,started_at=?,completed_at=?,milestones=?,skipped=?,analytics_consent=?,consented_at=?,updated_at=?,revision=revision+1 WHERE user_id=?').run(status,experience,started,completed,JSON.stringify(milestones),JSON.stringify([...skipped]),consent,consentedAt,now(),userId);
   if(!consent)db.prepare('DELETE FROM onboarding_events WHERE user_id=?').run(userId);
   row=rowFor(userId);
   if(body.operation==='start'||body.operation==='resume')record(row,'welcome','started');
   if(body.operation==='pause'||body.operation==='dismiss')record(row,step,body.operation==='pause'?'paused':'dismissed');
   if(body.operation==='skip')record(row,body.step,'skipped');
   if(body.operation==='review')record(row,'insights','completed');
   if(body.operation==='finish')record(row,'insights','finished');
   db.prepare('INSERT INTO onboarding_receipts(user_id,mutation_id,request_hash,created_at) VALUES(?,?,?,?)').run(userId,body.mutationId,hash,now());
   db.prepare('DELETE FROM onboarding_receipts WHERE user_id=? AND mutation_id NOT IN (SELECT mutation_id FROM onboarding_receipts WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100)').run(userId,userId);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return output(row);
 }
 function event(userId,body){
  exact(body,['step','kind','reason']);
  if(!ONBOARDING_STEPS.includes(body.step)||!EVENT_KINDS.has(body.kind)||(body.reason!==undefined&&(body.kind!=='blocked'||!ERROR_KINDS.has(body.reason))))reject(400,'INVALID_ONBOARDING_EVENT','Send only a supported step and interaction type.');
  const row=rowFor(userId);if(!row?.analytics_consent||!row.started_at)return {recorded:false};
  prune();record(row,body.step,body.kind,body.reason??null);return {recorded:true};
 }
 function aggregate({days=30,cohort='new',experience='all',inactiveDays=1}={}){
  if(![7,30,90].includes(days)||!['new','existing','all'].includes(cohort)||!['beginner','familiar','all'].includes(experience)||![1,7].includes(inactiveDays))reject(400,'INVALID_FUNNEL_FILTER','Choose a supported report period and cohort.');
  prune();const cutoff=now()-days*DAY,inactiveBefore=now()-inactiveDays*DAY;
  const rows=db.prepare('SELECT * FROM onboarding_progress WHERE analytics_consent=1 AND started_at>=? AND started_at<=? AND (?=\'all\' OR cohort=?) AND (?=\'all\' OR experience=?)').all(cutoff,now(),cohort,cohort,experience,experience);
  const recentEvents=db.prepare('SELECT e.user_id,e.step,e.kind,e.reason,max(e.created_at) AS latest FROM onboarding_events e JOIN onboarding_progress p ON p.user_id=e.user_id WHERE p.analytics_consent=1 AND p.started_at>=? AND p.started_at<=? AND (?=\'all\' OR p.cohort=?) AND (?=\'all\' OR p.experience=?) GROUP BY e.user_id,e.step,e.kind,e.reason').all(cutoff,now(),cohort,cohort,experience,experience);
  const eventsByUser=new Map();for(const event of recentEvents){const values=eventsByUser.get(event.user_id)??[];values.push(event);eventsByUser.set(event.user_id,values);}
  const journeys=rows.map(row=>{const milestones=JSON.parse(row.milestones),skipped=JSON.parse(row.skipped),events=eventsByUser.get(row.user_id)??[],last=Math.max(row.updated_at,...events.map(e=>e.latest));return {row,milestones,skipped,events,last};});
  const median=values=>{if(!values.length)return null;values.sort((a,b)=>a-b);const middle=Math.floor(values.length/2);return Math.round(values.length%2?values[middle]:(values[middle-1]+values[middle])/2);};
  const steps=ONBOARDING_STEPS.map((step,index)=>{
   const reached=journeys.filter(journey=>ONBOARDING_STEPS.slice(0,index+1).every(s=>journey.milestones[s]));
   const previous=index?journeys.filter(journey=>ONBOARDING_STEPS.slice(0,index).every(s=>journey.milestones[s])):journeys;
   const waiting=previous.filter(journey=>!journey.milestones[step]);
   const durations=reached.map(journey=>journey.milestones[step]-(index?journey.milestones[ONBOARDING_STEPS[index-1]]:journey.row.started_at)).filter(ms=>ms>=0);
   return {id:step,label:STEP_LABELS[step],reached:reached.length,eligible:previous.length,conversion:previous.length?Math.round(1000*reached.length/previous.length)/10:null,
    likelyDropOff:waiting.filter(journey=>journey.last<inactiveBefore&&!journey.skipped.includes(step)&&!['paused','dismissed','completed'].includes(journey.row.status)).length,
    stillActive:waiting.filter(journey=>journey.last>=inactiveBefore&&journey.row.status==='active'&&!journey.skipped.includes(step)).length,
    deferred:journeys.filter(journey=>journey.skipped.includes(step)&&!journey.milestones[step]).length,
    viewed:journeys.filter(journey=>journey.events.some(event=>event.step===step&&event.kind==='viewed')).length,
    actions:journeys.filter(journey=>journey.events.some(event=>event.step===step&&event.kind==='action')).length,
    blocked:journeys.filter(journey=>journey.events.some(event=>event.step===step&&event.kind==='blocked')).length,
    medianSeconds:durations.length?Math.round(median(durations)/1000):null};
  });
  const blockers=ONBOARDING_STEPS.flatMap(step=>[...ERROR_KINDS].map(reason=>({step,reason,users:journeys.filter(journey=>journey.events.some(event=>event.step===step&&event.kind==='blocked'&&event.reason===reason)).length}))).filter(item=>item.users>0).sort((a,b)=>b.users-a.users);
  const cohorts=[];for(let back=Math.min(days,14)-1;back>=0;back--){const date=new Date(now()-back*DAY).toISOString().slice(0,10),members=journeys.filter(journey=>iso(journey.row.started_at).startsWith(date));cohorts.push({date,started:members.length,completed:members.filter(journey=>journey.row.status==='completed').length});}
  return {version:1,generatedAt:iso(now()),window:{days,cohort,experience,inactiveDays},sampleSize:rows.length,finished:journeys.filter(journey=>journey.row.status==='completed').length,
   activated:journeys.filter(journey=>['budget','plan','purchase'].every(step=>journey.milestones[step])).length,
   ahaReached:journeys.filter(journey=>journey.milestones.aha).length,
   ahaMedianSeconds:(()=>{const times=journeys.filter(j=>j.milestones.aha>=j.row.started_at).map(j=>j.milestones.aha-j.row.started_at);return times.length?Math.round(median(times)/1000):null;})(),
   paused:journeys.filter(journey=>journey.row.status==='paused').length,dismissed:journeys.filter(journey=>journey.row.status==='dismissed').length,
   steps,blockers,cohorts,retentionDays:90,
   scope:'Only users who started the guide and opted to share setup progress. Sequential funnel completion requires every preceding milestone; deferred steps are not conversions. Existing/imported work may predate the guide. Inactivity is a signal, not proof of abandonment.'};
 }
 function feedback(userId,body){
  exact(body,['rating','understood','comment','mutationId']);
  if(body.comment!==undefined&&(typeof body.comment!=='string'||body.comment.length>1000))reject(400,'INVALID_FEEDBACK','Keep written feedback within 1,000 characters.');
  const comment=(body.comment??'').trim();
  if(!Number.isInteger(body.rating)||body.rating<1||body.rating>5||!['yes','partly','no'].includes(body.understood)||typeof body.mutationId!=='string'||!/^[a-zA-Z0-9_-]{16,128}$/.test(body.mutationId))reject(400,'INVALID_FEEDBACK','Choose a rating from 1 to 5 and whether the guide helped.');
  if(!db.prepare('SELECT 1 FROM budgets WHERE owner_id=? LIMIT 1').get(userId))reject(409,'FEEDBACK_NOT_READY','Create your budget before reviewing setup.');
  const existing=db.prepare('SELECT * FROM onboarding_feedback WHERE user_id=?').get(userId);
  if(existing){if(existing.mutation_id===body.mutationId&&(existing.rating!==body.rating||existing.understood!==body.understood||existing.comment!==comment))reject(409,'FEEDBACK_REQUEST_REUSED','This request was already used for different answers.');return {recorded:true,replayed:true};}
  db.prepare('INSERT INTO onboarding_feedback(user_id,rating,understood,mutation_id,created_at,comment) VALUES(?,?,?,?,?,?)').run(userId,body.rating,body.understood,body.mutationId,now(),comment);
  return {recorded:true};
 }
 function feedbackReport(){
  const rows=db.prepare('SELECT rating,understood FROM onboarding_feedback WHERE created_at>=?').all(now()-90*DAY);
  const comments=db.prepare("SELECT rating,understood,comment,created_at FROM onboarding_feedback WHERE created_at>=? AND comment<>'' ORDER BY created_at DESC,user_id LIMIT 100").all(now()-90*DAY).map(row=>({rating:row.rating,understood:row.understood,comment:row.comment,createdAt:iso(row.created_at)}));
  return {comments,responses:rows.length,average:rows.length?Math.round(rows.reduce((n,r)=>n+r.rating,0)/rows.length*10)/10:null,ratings:[1,2,3,4,5].map(rating=>({rating,count:rows.filter(r=>r.rating===rating).length})),understood:Object.fromEntries(['yes','partly','no'].map(value=>[value,rows.filter(r=>r.understood===value).length])),days:90};
 }
 function completeSetup(userId,budgetId,budget){
  ensure(userId);syncBudget(userId,budgetId,budget);
  const row=rowFor(userId);if(row.budget_id!==budgetId)return;
  db.prepare("UPDATE onboarding_progress SET status='completed',started_at=COALESCE(started_at,?),completed_at=COALESCE(completed_at,?),updated_at=?,revision=revision+1 WHERE user_id=?").run(now(),now(),now(),userId);
 }
 return {get,command,event,syncBudget,aggregate,feedback,feedbackReport,completeSetup};
}
