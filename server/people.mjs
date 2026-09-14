import {randomUUID} from 'node:crypto';
import {sharePlanSchema,cents} from '../src/engine.ts';

/** Private contacts belong to the authenticated account, independent of groups. */
export function createPeopleService(db,{operations,profile,requireEditing,fail,uuid,hash}){
 db.exec(`CREATE TABLE IF NOT EXISTS private_people(
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_key TEXT NOT NULL,name TEXT NOT NULL,email TEXT,created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,person_key)) STRICT;
  CREATE UNIQUE INDEX IF NOT EXISTS private_people_email ON private_people(user_id,email) WHERE email IS NOT NULL;
  CREATE TABLE IF NOT EXISTS people_migrations(id TEXT PRIMARY KEY) STRICT;
  CREATE TABLE IF NOT EXISTS planned_share_plans(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
   budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,schedule_id TEXT NOT NULL,plan TEXT NOT NULL,
   PRIMARY KEY(budget_id,schedule_id)) STRICT;`);
 const emailPattern=/^\S+@[^\s@]+\.[^\s@]+$/;
 const connectionCache=new Map();
 function connections(user){
  if(connectionCache.has(user))return connectionCache.get(user);
  const owned=db.prepare('SELECT * FROM private_people WHERE user_id=? ORDER BY created_at,person_key').all(user);
  const actor=profile(user);
  const members=actor.emailVerified?db.prepare(`SELECT other.* FROM expense_group_members other JOIN expense_group_members me ON me.group_id=other.group_id
   WHERE me.user_id=? AND me.state='active' AND (other.user_id IS NULL OR other.user_id!=?) AND other.state!='removed' ORDER BY other.rowid`).all(user,user):[];
  // Only recognize payer emails that are already visible through a share
  // addressed to this authenticated user. Group membership alone grants none.
  const knownPayers=actor.emailVerified?new Set(db.prepare(`SELECT DISTINCT u.email FROM shared_expenses e
   JOIN expense_shares s ON s.expense_id=e.id JOIN users u ON u.id=e.owner_id
   WHERE s.recipient_id=? OR (s.recipient_id IS NULL AND s.email=?)`).all(user,actor.email.toLowerCase()).map(row=>row.email)):new Set();
  const families=new Map();
  for(const member of members){
   const key=member.user_id??(member.invited_by===user&&member.person_key?'contact:'+member.person_key:'member:'+member.id);
   if(!families.has(key))families.set(key,[]);families.get(key).push(member);
  }
  const aliases=new Map(),emails=new Map(),people=new Map(),keys=new Map(),claimed=new Map();
  for(const family of families.values()){
   const account=family[0].user_id;
   const contacts=owned.filter(p=>(!account||!claimed.has(p.person_key)||claimed.get(p.person_key)===account)&&family.some(m=>p.person_key===m.id||(m.invited_by===user&&m.person_key===p.person_key)||(p.email&&p.email===m.email)));
   if(account)for(const contact of contacts)claimed.set(contact.person_key,account);
   const first=contacts[0]??{person_key:family[0].id,name:family[0].name,email:null};
   const person={id:first.person_key,name:first.name,email:first.email??''};
   people.set(person.id,person);
   const all=new Set([person.id,...contacts.map(p=>p.person_key),...family.map(m=>m.id)]);
   for(const contact of contacts)if(contact.email)all.add(contact.email);
   for(const member of family)if(member.email&&knownPayers.has(member.email))all.add(member.email);
   for(const key of all){aliases.set(key,person);if(!keys.has(person.id))keys.set(person.id,new Set());keys.get(person.id).add(key);}
   for(const member of family)if(member.email)emails.set(member.email,person);
  }
  const result={aliases,emails,people,keys};connectionCache.set(user,result);queueMicrotask(()=>connectionCache.delete(user));return result;
 }
 function find(user,key,email){
  if(key){const found=db.prepare('SELECT * FROM private_people WHERE user_id=? AND person_key=?').get(user,key);if(found)return found;}
  if(email)return db.prepare('SELECT * FROM private_people WHERE user_id=? AND email=?').get(user,email);
 }
 function resolve(user,input={},migrating=false){
  connectionCache.delete(user);
  const owner=profile(user),key=typeof input.personKey==='string'?input.personKey.trim().toLowerCase():'';
  const address=typeof input.email==='string'&&input.email.trim()?input.email.trim().toLowerCase():null;
  let name=typeof input.name==='string'?input.name.trim():'';
  if(key&&(!uuid(key)&&!emailPattern.test(key)))fail(400,'PERSON_KEY','Choose a valid person.');
  if(address&&(address.length>254||!emailPattern.test(address)||address===owner.email.toLowerCase()))fail(400,'PERSON_EMAIL','Enter another person’s valid email.');
  if(key===owner.email.toLowerCase())fail(400,'PERSON_SELF','You are already included.');
  const existing=find(user,key,address);
  if(existing)return existing;
  if(!name&&address)name=address.split('@')[0];
  if(!name||name.length>100||/[<>\u0000-\u001f\u007f]/.test(name))fail(400,'PERSON_NAME','Enter a name with up to 100 characters.');
  if(!migrating&&db.prepare('SELECT count(*) n FROM private_people WHERE user_id=?').get(user).n>=2000)fail(409,'PERSON_LIMIT','This account has reached its contact limit.');
  const id=key||randomUUID();
  db.prepare('INSERT INTO private_people(user_id,person_key,name,email,created_at) VALUES(?,?,?,?,?)').run(user,id,name,address,Date.now());
  return find(user,id);
 }
 const project=row=>({id:row.person_key,name:row.name,email:row.email??''});
 function list(user){
  profile(user);const linked=connections(user),all=new Map(linked.people);
  for(const row of db.prepare('SELECT * FROM private_people WHERE user_id=? ORDER BY name COLLATE NOCASE,person_key').all(user)){
   const value=linked.aliases.get(row.person_key)??project(row);all.set(value.id,value);
  }
  return {version:1,people:[...all.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id))};
 }
 function create(user,body){
  profile(user);requireEditing(user);
  if(!uuid(body.operationId))fail(400,'PERSON_OPERATION','Use a unique operation ID.');
  operations.assertOpen(user,'shared','',body.operationId);
  const requestHash='person-v1:'+hash({name:body.name,email:body.email??'',personKey:body.personKey??''});
  const prior=db.prepare('SELECT * FROM shared_operations WHERE user_id=? AND operation_id=?').get(user,body.operationId);
  if(prior){if(prior.request_hash!==requestHash)fail(409,'SHARE_OPERATION_REUSED','Retry the original request.');return {...JSON.parse(prior.response),replayed:true};}
  if(db.prepare('SELECT 1 FROM shared_operation_tombstones WHERE user_id=? AND operation_id=?').get(user,body.operationId))fail(409,'SHARED_HISTORY_CHANGED','Review your current contacts before retrying.');
  db.exec('BEGIN IMMEDIATE');
  try{
   const response={person:project(resolve(user,body))};
   db.prepare('INSERT INTO shared_operations VALUES(?,?,?,?,?)').run(user,body.operationId,requestHash,JSON.stringify(response),Date.now());
   operations.record(user,'shared','',body.operationId);
   db.exec('COMMIT');return response;
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 function canonical(user,key,email=''){
  const linked=connections(user),connected=linked.aliases.get(key)||(email?linked.emails.get(email):null);
  if(connected)return {...connected,email:connected.email||email||''};
  let found=find(user,key,email||null);
  if(!found&&key){
   const member=db.prepare('SELECT person_key FROM expense_group_members WHERE id=? AND invited_by=?').get(key,user);
   if(member?.person_key)found=find(user,member.person_key);
   if(!found){
    const prior=db.prepare('SELECT s.person_key,s.email FROM expense_shares s JOIN shared_expenses e ON e.id=s.expense_id WHERE e.owner_id=? AND s.group_member_id=? ORDER BY e.created_at DESC LIMIT 1').get(user,key);
    if(prior)found=find(user,prior.person_key,prior.email);
   }
  }
  return found?project(found):null;
 }
 function aliases(user,key){
  const person=canonical(user,key,key.includes('@')?key:'');
  if(!person)return [key];
  const values=new Set([person.id,...(person.email?[person.email]:[])]);
  for(const alias of connections(user).keys.get(person.id)??[])values.add(alias);
  for(const row of db.prepare('SELECT DISTINCT s.person_key,s.email,s.group_member_id FROM expense_shares s JOIN shared_expenses e ON e.id=s.expense_id WHERE e.owner_id=? AND (s.person_key=? OR (? IS NOT NULL AND s.email=?))').all(user,person.id,person.email||null,person.email||null)){
   if(row.person_key)values.add(row.person_key);if(row.email)values.add(row.email);if(row.group_member_id)values.add(row.group_member_id);
  }
  for(const row of db.prepare('SELECT id FROM expense_group_members WHERE invited_by=? AND person_key=?').all(user,person.id))values.add(row.id);
  return [...values];
 }
 const plans=(user,budget)=>db.prepare('SELECT schedule_id,plan FROM planned_share_plans WHERE user_id=? AND budget_id=? ORDER BY schedule_id').all(user,budget).map(row=>({scheduleId:row.schedule_id,plan:JSON.parse(row.plan)}));
 function validatePlans(budget,input){
  if(!Array.isArray(input)||input.length>1000)fail(400,'PLANNED_SHARES','Check the planned shares.');
  const ids=new Set();
  return input.map(item=>{
   const schedule=budget.schedules?.find(s=>s.id===item?.scheduleId);
   if(!schedule||schedule.frequency!=='once'||schedule.template.kind!=='expense'||ids.has(item.scheduleId))fail(400,'PLANNED_SHARES','Choose each upcoming bill once.');
   ids.add(item.scheduleId);
   let plan;try{plan=sharePlanSchema.parse(item.plan);}catch{fail(400,'PLANNED_SHARES','Check every person and amount in the planned split.');}
   if(plan.method==='equal'&&schedule.template.amount<plan.people.length+1)fail(400,'PLANNED_SHARES','The bill is too small to give everyone a share.');
   if(plan.method==='amount'){
    let remaining=schedule.template.amount;
    for(const person of plan.people){let amount;try{amount=cents(person.amount);}catch{fail(400,'PLANNED_SHARES','Enter a valid share for each person.');}
     if(amount<=0||amount>remaining)fail(400,'PLANNED_SHARES','The planned shares must fit within the bill total.');remaining-=amount;}
   }
   return {scheduleId:item.scheduleId,plan};
  }).sort((a,b)=>a.scheduleId.localeCompare(b.scheduleId));
 }
 function updatePlans(user,budgetId,budget,input){
  if(!db.prepare('SELECT 1 FROM budgets WHERE id=? AND owner_id=?').get(budgetId,user))fail(404,'BUDGET_NOT_FOUND','Budget not found.');
  const current=plans(user,budgetId);
  if(input===undefined){
   if(current.some(item=>!budget.schedules?.some(s=>s.id===item.scheduleId)))fail(409,'PLANNED_SHARES_REVIEW','Review this bill’s people and shares in the current iPhone app before recording or removing it.');
   validatePlans(budget,current);return current;
  }
  const next=validatePlans(budget,input);
  for(const item of next)for(const person of item.plan.people)resolve(user,{personKey:person.id,name:person.name,email:person.email});
  db.prepare('DELETE FROM planned_share_plans WHERE user_id=? AND budget_id=?').run(user,budgetId);
  for(const item of next)db.prepare('INSERT INTO planned_share_plans VALUES(?,?,?,?)').run(user,budgetId,item.scheduleId,JSON.stringify(item.plan));
  return next;
 }
 function prunePlans(user,budgetId,budget){
  for(const item of plans(user,budgetId))if(!budget.schedules?.some(s=>s.id===item.scheduleId)){
   db.prepare('DELETE FROM planned_share_plans WHERE user_id=? AND budget_id=? AND schedule_id=?').run(user,budgetId,item.scheduleId);
  }
  return plans(user,budgetId);
 }
 function migrate(){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='auth_users'").get())return;
 if(!db.prepare("SELECT 1 FROM people_migrations WHERE id='existing-history-v1'").get()){
  db.exec('BEGIN IMMEDIATE');
  try{
   const rows=db.prepare(`SELECT e.owner_id user_id,COALESCE(s.person_key,s.email) person_key,s.name,s.email FROM expense_shares s JOIN shared_expenses e ON e.id=s.expense_id JOIN auth_users u ON u.id=e.owner_id ORDER BY e.created_at,s.id`).all();
   for(const row of rows){if(row.person_key)resolve(row.user_id,{personKey:row.person_key,name:row.name,email:row.email},true);}
   db.prepare("INSERT INTO people_migrations VALUES('existing-history-v1')").run();
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 }
 migrate();
 return {list,create,resolve,canonical,aliases,plans,validatePlans,updatePlans,prunePlans,migrate,invalidate:()=>connectionCache.clear()};
}
