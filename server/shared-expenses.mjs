import {createSharedGroups} from './shared-groups.mjs';
import {migrateSharedContacts} from './shared-schema.mjs';
import {validateSharedReceipt} from './shared-receipts.mjs';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {validateBudget,isCashAccount,today} from '../src/engine.ts';
import {appendSharedPurchase} from '../src/shared-purchase.ts';
import {createPeopleService} from './people.mjs';
import {createOperationStatus} from './operation-status.mjs';

export class SharedExpenseError extends Error { constructor(status,code,message){super(message);Object.assign(this,{status,code});} }
const fail=(status,code,message)=>{throw new SharedExpenseError(status,code,message);};
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const canonical=(value,depth=0)=>{if(depth>64)fail(400,'SHARE_REQUEST_DEPTH','This request is nested too deeply.');return Array.isArray(value)?value.map(item=>canonical(item,depth+1)):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key],depth+1)])):value;};
const financial=e=>e?JSON.stringify([e.id,e.kind,e.amount,e.date,e.accountId,e.toAccountId,e.categoryId,e.splits,e.refundOf,e.reimbursement,e.sharedSettlementId,e.sharedExpenseId,e.sharedShareId,e.sharedAmount,e.sharedReduction,e.againstExpenseId,e.reversalOf]):null;
const amount=v=>Number.isSafeInteger(v)&&v>0&&v<=1_000_000_000_000;

export function createSharedExpenses(db,{operations=createOperationStatus(db),requireEditing=()=>{},publish=()=>{},recordChange=()=>{},notify=()=>{},origin='https://spenton.dev'}={}){
 db.exec(`CREATE TABLE IF NOT EXISTS shared_expenses(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),budget_id TEXT NOT NULL REFERENCES budgets(id),entry_id TEXT NOT NULL,currency TEXT NOT NULL,total INTEGER NOT NULL,merchant TEXT NOT NULL,purchase_date TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(budget_id,entry_id)) STRICT;
 CREATE TABLE IF NOT EXISTS expense_shares(id TEXT PRIMARY KEY,expense_id TEXT NOT NULL REFERENCES shared_expenses(id) ON DELETE CASCADE,email TEXT NOT NULL,amount INTEGER NOT NULL,state TEXT NOT NULL,recipient_id TEXT REFERENCES users(id),budget_id TEXT REFERENCES budgets(id),UNIQUE(expense_id,email)) STRICT;
 CREATE INDEX IF NOT EXISTS expense_share_email ON expense_shares(email);
 CREATE TABLE IF NOT EXISTS share_settlements(id TEXT PRIMARY KEY,share_id TEXT NOT NULL REFERENCES expense_shares(id) ON DELETE CASCADE,amount INTEGER NOT NULL,state TEXT NOT NULL,paid_date TEXT NOT NULL,payment_entry TEXT NOT NULL,received_entry TEXT,created_at INTEGER NOT NULL) STRICT;
 CREATE TABLE IF NOT EXISTS shared_operation_tombstones(user_id TEXT NOT NULL,operation_id TEXT NOT NULL,request_hash TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,operation_id)) STRICT;
 CREATE TABLE IF NOT EXISTS shared_operations(user_id TEXT NOT NULL REFERENCES users(id),operation_id TEXT NOT NULL,request_hash TEXT NOT NULL,response TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,operation_id)) STRICT;`);
 migrateSharedContacts(db);
 if(!db.prepare('PRAGMA table_info(shared_expenses)').all().some(c=>c.name==='ledger_version'))db.exec('ALTER TABLE shared_expenses ADD COLUMN ledger_version INTEGER NOT NULL DEFAULT 1');
 if(!db.prepare("PRAGMA table_info(share_settlements)").all().some(c=>c.name==='payer_recorded'))db.exec("ALTER TABLE share_settlements ADD COLUMN payer_recorded INTEGER NOT NULL DEFAULT 0");
 db.exec(`CREATE TABLE IF NOT EXISTS shared_receipts(expense_id TEXT PRIMARY KEY REFERENCES shared_expenses(id) ON DELETE CASCADE,document TEXT NOT NULL) STRICT;
 CREATE TABLE IF NOT EXISTS share_invitations(share_id TEXT PRIMARY KEY REFERENCES expense_shares(id) ON DELETE CASCADE,token_hash TEXT NOT NULL UNIQUE,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL) STRICT;`);
 const personKey=s=>s.person_key??s.email;
 const receipt=e=>{const row=db.prepare('SELECT document FROM shared_receipts WHERE expense_id=?').get(e.id);return row?JSON.parse(row.document):null;};
 function profile(userId){const p=db.prepare('SELECT id,email,emailVerified FROM auth_users WHERE id=?').get(userId);if(!p)fail(401,'UNAUTHENTICATED','Sign in again.');return p;}
 function verified(userId){const p=profile(userId);if(!p.emailVerified)fail(403,'SHARE_VERIFY_EMAIL','Verify your email in account settings before sharing expenses.');return p;}
 function ownedBudget(userId,budgetId,revision){
  const row=db.prepare('SELECT * FROM budgets WHERE id=? AND owner_id=?').get(budgetId??'',userId);
  if(!row)fail(404,'BUDGET_NOT_FOUND','Budget not found.');
  if(!Number.isSafeInteger(revision)||row.revision!==revision)fail(409,'REVISION_CONFLICT','This budget changed or its saved version is missing. Keep your draft and reload before trying again.');
  return {...row,budget:validateBudget(JSON.parse(row.document))};
 }
 function expense(id){const e=db.prepare('SELECT * FROM shared_expenses WHERE id=?').get(id);if(!e)fail(404,'SHARE_NOT_FOUND','Shared expense not found.');return e;}
 function shares(id){return db.prepare('SELECT * FROM expense_shares WHERE expense_id=? ORDER BY id').all(id);}
 function share(id){const s=db.prepare('SELECT * FROM expense_shares WHERE id=?').get(id);if(!s)fail(404,'SHARE_NOT_FOUND','Share not found.');return s;}
 function settlements(id,all=false){return db.prepare('SELECT * FROM share_settlements WHERE share_id=?'+(all?'':" AND state!='reversed'")+' ORDER BY created_at,id').all(id);}
 function render(userId,e,budgetCache=new Map()){
  const owner=e.owner_id===userId,p=profile(userId),all=shares(e.id),visible=owner?all:all.filter(s=>s.recipient_id===userId||(!s.recipient_id&&s.email===p.email.toLowerCase()));
  if(!visible.length&&!owner)fail(404,'SHARE_NOT_FOUND','Shared expense not found.');
  if(owner&&!budgetCache.has(e.budget_id)){const row=db.prepare('SELECT document FROM budgets WHERE id=? AND owner_id=?').get(e.budget_id,userId);budgetCache.set(e.budget_id,row?JSON.parse(row.document):null);}
  const original=owner?budgetCache.get(e.budget_id)?.entries.find(row=>row.id===e.entry_id):undefined;
  return {combinedBillId:db.prepare('SELECT bill_id FROM group_bill_parts WHERE expense_id=?').get(e.id)?.bill_id,categoryId:original?.categoryId,categorySplits:original?.splits,groupId:e.group_id,groupName:e.group_id?db.prepare('SELECT name FROM expense_groups WHERE id=?').get(e.group_id)?.name:undefined,groupBudgetId:e.group_id?groups.budgetIdFor(userId,e.group_id):undefined,kind:e.kind,refunded:e.refunded_total,expenseRevision:e.revision,groupVersion:1,ledgerVersion:e.ledger_version,hasReceipt:!!db.prepare('SELECT 1 FROM shared_receipts WHERE expense_id=?').get(e.id),id:e.id,owned:owner,merchant:e.merchant,total:e.total,currency:e.currency,date:e.purchase_date,payer:db.prepare('SELECT email FROM users WHERE id=?').get(e.owner_id)?.email??'Former member',entryId:owner?e.entry_id:null,budgetId:owner?e.budget_id:null,
   shares:visible.map(s=>{const payments=settlements(s.id,true),contact=owner?people?.canonical(userId,personKey(s),s.email):null;return {...groups.pendingForShare(userId,s.id),originalAmount:s.amount,refunded:s.refunded??0,offset:groups.offsetForShare(s.id),id:s.id,email:s.email??'',name:contact?.name??s.name,personKey:contact?.id??personKey(s),amount:s.amount-(s.refunded??0),state:s.state,budgetId:s.recipient_id===userId?s.budget_id:null,confirmed:payments.filter(p=>p.state==='confirmed').reduce((n,p)=>n+p.amount,0),pending:payments.filter(p=>['pending','disputed'].includes(p.state)).reduce((n,p)=>n+p.amount,0),settlements:payments.map(p=>({id:p.id,amount:p.amount,state:p.state,date:p.paid_date,recordedByPayer:!!p.payer_recorded,recordedInYourBudget:s.recipient_id===userId?!!p.payment_entry:null}))};})};
 }
 function list(userId,{person='',offset=0,groupId=''}={}){
  const p=profile(userId);if(!p.emailVerified)return {ledgerVersion:2,verificationRequired:true,expenses:[],balances:[],hasMore:false};
  if(typeof person!=='string'||person.length>254||!Number.isSafeInteger(offset)||offset<0||offset>1_000_000)fail(400,'INVALID_SHARE_PAGE','Choose a person and a valid page.');
  person=person.trim().toLowerCase();if(groupId)groups.get(userId,groupId);
  const personKeys=person?people.aliases(userId,person):[''],slots=personKeys.map(()=>'?').join(',');
  const visible="(e.owner_id=? OR s.recipient_id=? OR (s.recipient_id IS NULL AND s.email=?))",identity=[userId,userId,p.email.toLowerCase()];
  const balanceRows=db.prepare(`SELECT CASE WHEN e.owner_id=? THEN COALESCE(s.person_key,s.email) ELSE u.email END personKey,e.currency,
   max(CASE WHEN e.owner_id=? THEN s.email ELSE u.email END) email,
   max(CASE WHEN e.owner_id=? THEN s.name ELSE '' END) name,
   sum(CASE WHEN (s.state='accepted' OR (e.ledger_version=2 AND s.state IN ('invited','declined'))) AND e.owner_id=? THEN max(0,s.amount-s.refunded-COALESCE(paid.confirmed,0)-COALESCE(offsets.total,0)) ELSE 0 END) owedToYou,
   sum(CASE WHEN s.state='accepted' AND e.owner_id!=? THEN max(0,s.amount-s.refunded-COALESCE(paid.confirmed,0)-COALESCE(offsets.total,0)) ELSE 0 END) youOwe,
   sum(CASE WHEN s.state='accepted' AND e.owner_id=? THEN COALESCE(paid.pending,0) ELSE 0 END) pendingToYou,
   sum(CASE WHEN s.state='accepted' AND e.owner_id!=? THEN COALESCE(paid.pending,0) ELSE 0 END) pendingFromYou,
   sum(CASE WHEN s.state='invited' AND e.owner_id=? THEN max(0,s.amount-s.refunded-COALESCE(paid.confirmed,0)-COALESCE(offsets.total,0)) ELSE 0 END) requestedToYou,
   sum(CASE WHEN s.state='invited' AND e.owner_id!=? THEN max(0,s.amount-s.refunded-COALESCE(paid.confirmed,0)-COALESCE(offsets.total,0)) ELSE 0 END) requestedFromYou
   FROM expense_shares s JOIN shared_expenses e ON e.id=s.expense_id JOIN users u ON u.id=e.owner_id
   LEFT JOIN (SELECT share_id,sum(CASE WHEN state='confirmed' THEN amount ELSE 0 END) confirmed,sum(CASE WHEN state IN ('pending','disputed') THEN amount ELSE 0 END) pending FROM share_settlements GROUP BY share_id) paid ON paid.share_id=s.id
   LEFT JOIN (SELECT share_id,sum(amount) total FROM (SELECT first_share share_id,amount FROM share_offsets WHERE state='active' UNION ALL SELECT second_share share_id,amount FROM share_offsets WHERE state='active') GROUP BY share_id) offsets ON offsets.share_id=s.id
   WHERE ${visible} AND (?='' OR e.group_id=?) GROUP BY 1,2 ORDER BY owedToYou+youOwe DESC,personKey`).all(userId,userId,userId,userId,userId,userId,userId,userId,userId,...identity,groupId,groupId);
  if(balanceRows.some(row=>['owedToYou','youOwe','pendingToYou','pendingFromYou','requestedToYou','requestedFromYou'].some(key=>!Number.isSafeInteger(row[key]))))fail(409,'SHARE_TOTAL_LIMIT','These combined balances exceed the supported amount. Review the individual budgets.');
  const rows=db.prepare(`SELECT DISTINCT e.* FROM shared_expenses e JOIN expense_shares s ON s.expense_id=e.id JOIN users u ON u.id=e.owner_id
   WHERE ${visible} AND (?='' OR e.group_id=?) AND (?='' OR (e.owner_id=? AND (COALESCE(s.person_key,s.email) IN (${slots}) OR s.email IN (${slots}))) OR (e.owner_id!=? AND u.email IN (${slots})) OR
    (e.group_id IS NOT NULL AND EXISTS(SELECT 1 FROM expense_group_members me WHERE me.group_id=e.group_id AND me.user_id=? AND me.state='active')
     AND EXISTS(SELECT 1 FROM expense_shares other WHERE other.expense_id=e.id AND other.group_member_id IN (${slots}))))
    ORDER BY e.created_at DESC,e.id DESC LIMIT 201 OFFSET ?`).all(...identity,groupId,groupId,person,userId,...personKeys,...personKeys,userId,...personKeys,userId,...personKeys,offset);
  // Group bills use the existing active-membership boundary. A person's
  // history includes a bill only when both that person and the caller
  // actually have a cost share or payment in the recorded/reviewed plan.
  const groupRows=db.prepare(`SELECT DISTINCT plan.id FROM group_bill_plans plan
   JOIN expense_group_members me ON me.group_id=plan.group_id AND me.user_id=? AND me.state='active'
   WHERE (?='' OR plan.group_id=?)
   AND (EXISTS(SELECT 1 FROM json_each(plan.plan,'$.people') p WHERE json_extract(p.value,'$.memberId')=me.id AND json_extract(p.value,'$.amount')>0)
     OR EXISTS(SELECT 1 FROM json_each(plan.plan,'$.payers') p WHERE json_extract(p.value,'$.memberId')=me.id AND json_extract(p.value,'$.amount')>0))
   AND (?='' OR EXISTS(SELECT 1 FROM json_each(plan.plan,'$.people') p WHERE json_extract(p.value,'$.memberId') IN (${slots}) AND json_extract(p.value,'$.amount')>0)
     OR EXISTS(SELECT 1 FROM json_each(plan.plan,'$.payers') p WHERE json_extract(p.value,'$.memberId') IN (${slots}) AND json_extract(p.value,'$.amount')>0))
   ORDER BY plan.created_at DESC,plan.id DESC LIMIT 201 OFFSET ?`).all(userId,groupId,groupId,person,...personKeys,...personKeys,offset);
  const hasMore=rows.length>200||groupRows.length>200;
  const budgetCache=new Map();
  const combined=new Map();
  for(const row of balanceRows){
   const contact=people.canonical(userId,row.personKey,row.email),key=(contact?.id??row.personKey)+'\0'+row.currency;
   if(!combined.has(key))combined.set(key,{...row,personKey:contact?.id??row.personKey,name:contact?.name??row.name,email:contact?.email??row.email??''});
   else for(const field of ['owedToYou','youOwe','pendingToYou','pendingFromYou','requestedToYou','requestedFromYou']){
    const value=combined.get(key);value[field]+=row[field];if(!Number.isSafeInteger(value[field]))fail(409,'SHARE_TOTAL_LIMIT','Review the individual balances.');
   }
  }
  return {groupVersion:1,ledgerVersion:3,atomicPurchases:true,categorySplits:true,peopleVersion:1,verificationRequired:false,balances:[...combined.values()],expenses:rows.slice(0,200).map(e=>render(userId,e,budgetCache)),groupBills:groupRows.slice(0,200).map(row=>groups.bills.summary(userId,row.id)),hasMore,nextOffset:hasMore?offset+200:null};
 }
 function saveBudget(row,budget){
  try{budget=validateBudget(budget);}catch{fail(400,'INVALID_SHARED_ENTRY','Check the amount, date, account and category before recording this repayment.');}
  assertBudgetChange(row.owner_id,row.id,row.budget,budget,true);
  const now=Date.now(),changed=db.prepare('UPDATE budgets SET document=?,name=?,revision=revision+1,updated_at=? WHERE id=? AND owner_id=? AND revision=?').run(JSON.stringify(budget),budget.name,now,row.id,row.owner_id,row.revision);
  if(!changed.changes)fail(409,'REVISION_CONFLICT','This budget changed. Keep your draft and reload before trying again.');
  const snapshot={id:row.id,revision:row.revision+1,updatedAt:new Date(now).toISOString(),budget,plannedShares:people.prunePlans(row.owner_id,row.id,budget)};changedBudgets.set(row.id,{userId:row.owner_id,snapshot});return snapshot;
 }
 function transact(userId,body,action){
  verified(userId);if(!uuid(body.operationId))fail(400,'SHARE_OPERATION_REQUIRED','Use a unique operation ID.');
  operations.assertOpen(userId,'shared','',body.operationId);
  const requestHash='v2:'+hash(canonical(body)),legacyHash=hash(body),prior=db.prepare('SELECT * FROM shared_operations WHERE user_id=? AND operation_id=?').get(userId,body.operationId);
  if(prior){if(prior.request_hash!==requestHash&&prior.request_hash!==legacyHash)fail(409,'SHARE_OPERATION_REUSED','Retry the original change or discard it before editing.');return {...JSON.parse(prior.response),replayed:true};}
  if(db.prepare('SELECT 1 FROM shared_operation_tombstones WHERE user_id=? AND operation_id=?').get(userId,body.operationId))fail(409,'SHARED_HISTORY_CHANGED','This older request relates to removed account data. Review the current shared history instead of sending it again.');
  requireEditing(userId);let response;changedBudgets=new Map();
  db.exec('BEGIN IMMEDIATE');try{response=action();notify(userId,body,response);for(const change of changedBudgets.values())recordChange(change.userId,change.snapshot,body.operationId);db.prepare('INSERT INTO shared_operations VALUES(?,?,?,?,?)').run(userId,body.operationId,requestHash,JSON.stringify(response),Date.now());operations.record(userId,'shared','',body.operationId,response.snapshot);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');changedBudgets.clear();throw error;}
  for(const change of changedBudgets.values())publish(change.userId,change.snapshot.id);changedBudgets.clear();people?.invalidate();return response;
 }

 function create(userId,body){return transact(userId,{...body,action:'create'},()=>{
  const p=profile(userId),row=ownedBudget(userId,body.budgetId,body.expectedRevision);
  let working=row.budget;
  if(body.purchase!==undefined){
   if(![2,3].includes(body.ledgerVersion))fail(400,'UNIFIED_PURCHASE_REQUIRED','Update SpentOn before saving a purchase with its split.');
   try{working=appendSharedPurchase(row.budget,body.purchase);}catch{fail(400,'INVALID_SHARED_PURCHASE','Check the purchase amount, date, account and category. Nothing has been saved.');}
   if(body.purchase.entry.id!==body.entryId)fail(400,'INVALID_SHARED_PURCHASE','The split must belong to the new purchase.');
  }
  const entry=working.entries.find(e=>e.id===body.entryId);
  if(!entry||entry.kind!=='expense'||entry.sharedSettlementId||entry.sharedExpenseId||entry.date>today())fail(400,'INVALID_SHARED_PURCHASE','Choose a recorded purchase that has not been shared.');
  if(db.prepare('SELECT 1 FROM shared_expenses WHERE budget_id=? AND entry_id=?').get(row.id,entry.id))fail(409,'PURCHASE_ALREADY_SHARED','This purchase is already shared. Open People to see it.');
  if(!Array.isArray(body.shares)||body.shares.length<1||body.shares.length>20)fail(400,'INVALID_SHARES','Add between one and twenty people.');
  const participants=body.shares.map(s=>({email:typeof s.email==='string'&&s.email.trim()?s.email.trim().toLowerCase():null,name:typeof s.name==='string'?s.name.trim():'',personKey:typeof s.personKey==='string'?s.personKey.toLowerCase():null,amount:s.amount}));
  const group=groups.preparePurchase(userId,body,row,participants);
  const refundable=entry.amount-row.budget.entries.filter(e=>e.refundOf===entry.id).reduce((n,e)=>n+e.amount,0);
  if(participants.some(s=>!amount(s.amount)||s.name.length>100||/[<>\u0000-\u001f\u007f]/.test(s.name)||(s.email&&(s.email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(s.email)||s.email===p.email.toLowerCase()))||(!s.email&&!s.name)||(s.personKey&&!uuid(s.personKey)&&s.personKey!==s.email))||new Set(participants.filter(s=>s.email).map(s=>s.email)).size!==participants.filter(s=>s.email).length||participants.reduce((n,s)=>n+s.amount,0)>refundable)fail(400,'INVALID_SHARES','Add a name or valid email for each person. Their shares must fit within the unrefunded purchase total.');
  for(const person of participants){
   if(group)continue;
   if(person.personKey){
    const prior=db.prepare('SELECT s.* FROM expense_shares s JOIN shared_expenses e ON e.id=s.expense_id WHERE e.owner_id=? AND COALESCE(s.person_key,s.email)=? ORDER BY e.created_at DESC LIMIT 1').get(userId,person.personKey);
    if(prior){person.email=prior.email;person.name=prior.name;}
   }
   if(person.email){
    const existing=db.prepare('SELECT s.person_key FROM expense_shares s JOIN shared_expenses e ON e.id=s.expense_id WHERE e.owner_id=? AND s.email=? ORDER BY e.created_at DESC LIMIT 1').get(userId,person.email);
    person.personKey=existing?.person_key??person.email;
   }else person.personKey=person.personKey??randomUUID();
   const contact=people.resolve(userId,person);person.personKey=contact.person_key;if(person.name)person.name=contact.name;person.email=contact.email;
  }
  if(participants.some(s=>s.email===p.email.toLowerCase())||new Set(participants.map(s=>s.personKey)).size!==participants.length||new Set(participants.filter(s=>s.email).map(s=>s.email)).size!==participants.filter(s=>s.email).length)fail(400,'INVALID_SHARES','Add each person once.');
  const bill=validateSharedReceipt(body.receipt,fail);
  if(db.prepare('SELECT count(*) n FROM shared_expenses WHERE owner_id=? AND created_at>?').get(userId,Date.now()-86400000).n>=50)fail(429,'SHARE_LIMIT','You have reached today’s shared-expense limit.');
  const id=randomUUID(),ledgerVersion=group?3:body.ledgerVersion>=2?2:1;db.prepare('INSERT INTO shared_expenses(id,owner_id,budget_id,entry_id,currency,total,merchant,purchase_date,created_at,ledger_version) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,userId,row.id,entry.id,row.budget.currency,entry.amount,entry.payee,entry.date,Date.now(),ledgerVersion);
  for(const s of participants)db.prepare("INSERT INTO expense_shares(id,expense_id,email,amount,state,name,person_key) VALUES(?,?,?,?,'invited',?,?)").run(randomUUID(),id,s.email,s.amount,s.name,s.personKey);
  groups.attachPurchase(group,id,participants);
  if(bill)db.prepare('INSERT INTO shared_receipts VALUES(?,?)').run(id,JSON.stringify(bill));
  const snapshot=ledgerVersion>=2?saveBudget(row,{...working,version:Math.max(row.budget.version,ledgerVersion),entries:working.entries.map(p=>p.id===entry.id?{...p,sharedExpenseId:id,sharedAmount:participants.reduce((n,s)=>n+s.amount,0)}:p)}):undefined;
  return {expense:render(userId,expense(id)),...(snapshot?{snapshot}:{})};
 });}
 function respond(userId,id,body){return transact(userId,{...body,shareId:id},()=>{
  const p=profile(userId),s=share(id),e=expense(s.expense_id);let snapshot;
  requireLedgerClient(e,body);groups.assertUnlocked([s.id]);
  if(body.action==='cancel'){
   if(e.owner_id!==userId)fail(404,'SHARE_NOT_FOUND','Share not found.');
   if(!['invited','declined'].includes(s.state))fail(409,'SHARE_CHANGED','Only an unaccepted request can be cancelled.');
   if(s.refunded)fail(409,'SHARE_HAS_REFUND','A refunded share must remain linked to its original bill.');
   if(settlements(id).length)fail(409,'SHARE_HAS_REPAYMENTS','This share has a repayment record and cannot be cancelled.');
   if(e.ledger_version>=2){const row=ownedBudget(userId,e.budget_id,body.expectedRevision);snapshot=saveBudget(row,{...row.budget,entries:row.budget.entries.map(p=>p.id===e.entry_id?{...p,sharedAmount:p.sharedAmount-s.amount}:p)});}
   db.prepare("UPDATE expense_shares SET state='cancelled' WHERE id=?").run(id);
  }else{
   if(s.recipient_id?s.recipient_id!==userId:s.email!==p.email.toLowerCase())fail(404,'SHARE_NOT_FOUND','Share not found.');
   if(s.state!=='invited')fail(409,'SHARE_CHANGED','This request has already been answered. Refresh People.');
   if(body.action==='decline')db.prepare("UPDATE expense_shares SET state='declined',recipient_id=? WHERE id=?").run(userId,id);
   else if(body.action==='accept'){
    const row=ownedBudget(userId,body.budgetId,body.expectedRevision);groups.acceptBudget(userId,e,row);if(row.budget.currency!==e.currency)fail(400,'SHARE_CURRENCY','Choose a budget in this expense’s currency.');
    if(e.ledger_version>=2){
     if(!row.budget.categories.some(c=>c.id===body.categoryId))fail(400,'SHARE_CATEGORY','Choose the category for your share.');
     const charge={id:randomUUID(),kind:e.kind==='refund'?'shared_return':'shared_charge',amount:s.amount-s.refunded,date:e.purchase_date,categoryId:body.categoryId,sharedExpenseId:e.id,sharedShareId:s.id,payee:e.merchant,note:'Your share. Paid by '+profile(e.owner_id).email,cleared:true};
     snapshot=saveBudget(row,{...row.budget,version:Math.max(row.budget.version,e.ledger_version),entries:[...row.budget.entries,charge]});
    }
    db.prepare("UPDATE expense_shares SET state='accepted',recipient_id=?,budget_id=? WHERE id=?").run(userId,row.id,id);
   }else fail(400,'SHARE_ACTION','Choose accept, decline or cancel.');
  }
  groups.touchExpense(e.id);return {expense:render(userId,e),...(snapshot?{snapshot}:{})};
 });}
 function invite(userId,id,body){return transact(userId,{...body,shareId:id,action:'invite'},()=>{
  const s=share(id),e=expense(s.expense_id);
  if(e.owner_id!==userId)fail(404,'SHARE_NOT_FOUND','Share not found.');
  if(e.group_id&&!groups.budgetIdFor(s.recipient_id,e.group_id))fail(409,'GROUP_INVITE_REQUIRED','Invite this person from the group’s People section.');
  if(s.state!=='invited')fail(409,'SHARE_CHANGED','Only a share awaiting acceptance can be invited.');
  const previous=db.prepare('SELECT * FROM share_invitations WHERE share_id=?').get(id);
  if(previous?.expires_at>Date.now()){
   const cached=db.prepare("SELECT response FROM shared_operations WHERE user_id=? AND json_extract(response,'$.invitation.shareId')=? ORDER BY created_at DESC LIMIT 1").get(userId,id);
   if(cached){const invitation=JSON.parse(cached.response).invitation;const token=new URLSearchParams(new URL(invitation.url).hash.slice(1)).get('token');if(hash(token)===previous.token_hash)return {expense:render(userId,e),invitation};}
  }
  if(previous&&Date.now()-previous.created_at<60000)fail(429,'INVITE_LIMIT','Try again in a minute.');
  const token=randomBytes(32).toString('hex'),expires=Date.now()+7*86400000;
  db.prepare('INSERT INTO share_invitations VALUES(?,?,?,?) ON CONFLICT(share_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,created_at=excluded.created_at').run(id,hash(token),expires,Date.now());
  return {expense:render(userId,e),invitation:{shareId:id,url:origin+'/?share-invite#token='+token,expiresAt:new Date(expires).toISOString()}};
 });}
 function invitationFor(userId,token){
  const p=verified(userId);
  if(typeof token!=='string'||!/^[0-9a-f]{64}$/.test(token))fail(404,'INVITATION_NOT_FOUND','This invitation is invalid or expired. Ask the person who paid for a new link.');
  const link=db.prepare('SELECT * FROM share_invitations WHERE token_hash=? AND expires_at>?').get(hash(token),Date.now());
  if(!link)fail(404,'INVITATION_NOT_FOUND','This invitation is invalid or expired. Ask the person who paid for a new link.');
  const s=share(link.share_id),e=expense(s.expense_id);
  if(s.state!=='invited'||e.owner_id===userId||(s.recipient_id&&s.recipient_id!==userId)||(s.email&&s.email!==p.email.toLowerCase()))fail(403,'INVITATION_UNAVAILABLE','This invitation belongs to another person or has already been answered. Sign in with the invited email, or ask the person who paid to check it.');
  return {s,e,p};
 }
 function previewInvitation(userId,body){
  const {s,e}=invitationFor(userId,body.token);
  return {ledgerVersion:e.ledger_version,merchant:e.merchant,total:e.total,currency:e.currency,date:e.purchase_date,amount:s.amount,received:settlements(s.id).filter(p=>p.state==='confirmed').reduce((n,p)=>n+p.amount,0),payer:db.prepare('SELECT email FROM users WHERE id=?').get(e.owner_id)?.email??'Former member',name:s.name,receipt:receipt(e)};
 }
 function claimInvitation(userId,body){return transact(userId,{...body,action:'claim'},()=>{
  if(body.confirmRecipient!==true)fail(400,'CONFIRM_RECIPIENT','Confirm this share is for you.');
  const {s,e,p}=invitationFor(userId,body.token);
  if(db.prepare('SELECT 1 FROM expense_shares WHERE expense_id=? AND id!=? AND (recipient_id=? OR email=?)').get(e.id,s.id,userId,p.email.toLowerCase()))fail(409,'ALREADY_PARTICIPANT','You already have a share of this purchase.');
  db.prepare('UPDATE expense_shares SET email=?,recipient_id=? WHERE id=?').run(p.email.toLowerCase(),userId,s.id);
  return {expense:render(userId,e)};
 });}
 function sharedReceipt(userId,id){
  verified(userId);const e=expense(id),view=render(userId,e);
  if(!view.owned&&!view.shares.some(s=>['invited','accepted'].includes(s.state)))fail(404,'SHARE_NOT_FOUND','Bill not found.');
  const bill=receipt(e);if(!bill)fail(404,'BILL_NOT_FOUND','No bill was attached to this purchase.');return bill;
 }
 function repaymentEntry(e,s,row,entry){
  if(e.ledger_version<2)return entry;
  const charge=row.budget.entries.find(p=>['shared_charge','shared_return'].includes(p.kind)&&p.sharedShareId===s.id);
  if(!charge)fail(409,'SHARE_CHARGE_MISSING','Reload your budget to review the accepted share.');
  return {...entry,kind:'shared_payment',categoryId:charge.categoryId,sharedExpenseId:e.id,sharedShareId:s.id};
 }
 function receivedEntry(e,s,entry){
  if(e.ledger_version<2)return entry;
  const {refundOf,reimbursement,...rest}=entry;
  return {...rest,kind:'shared_receipt',sharedExpenseId:e.id,sharedShareId:s.id};
 }
 function requireLedgerClient(e,body){if(e.ledger_version>=2&&(![2,3].includes(body.ledgerVersion)||e.ledger_version===3&&body.ledgerVersion!==3))fail(426,'UPDATE_REQUIRED','Update SpentOn before recording this shared payment.');}
 function repay(userId,id,body){return transact(userId,{...body,shareId:id,action:'repay'},()=>{
  const s=share(id),e=expense(s.expense_id);requireLedgerClient(e,body);
  if(s.recipient_id!==userId)fail(404,'SHARE_NOT_FOUND','Share not found.');
  if(s.state!=='accepted'||body.confirmPaid!==true)fail(400,'PAYMENT_CONFIRMATION','Confirm that you have paid this person before recording a repayment.');
  groups.assertUnlocked([s.id]);const remaining=Math.max(0,s.amount-s.refunded-groups.offsetForShare(s.id)-settlements(id).reduce((n,p)=>n+p.amount,0));
  if(!amount(body.amount)||body.amount>remaining)fail(400,'REPAYMENT_AMOUNT','Enter an amount within your unpaid share. Pending repayments are already included.');
  groups.assertUnlocked([s.id]);const row=ownedBudget(userId,s.budget_id,body.expectedRevision),account=row.budget.accounts.find(a=>a.id===body.accountId);
  if(!account||!isCashAccount(account))fail(400,'REPAYMENT_ACCOUNT','Choose the cash account you paid from.');
  if(e.ledger_version<2&&!row.budget.categories.some(c=>c.id===body.categoryId))fail(400,'REPAYMENT_CATEGORY','Choose a category for your share.');
  if(row.budget.currency!==e.currency)fail(409,'SHARE_CURRENCY','This budget’s currency changed.');
  const date=body.date;if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>today()||date<e.purchase_date)fail(400,'REPAYMENT_DATE','Choose the date you paid, from the purchase date through today.');
  const paymentId=randomUUID(),entryId=randomUUID();
  const entry={id:entryId,kind:'expense',amount:body.amount,date,accountId:account.id,categoryId:body.categoryId,payee:profile(e.owner_id).email.slice(0,160),note:'Repayment for '+e.merchant,cleared:false,sharedSettlementId:paymentId};
  const snapshot=saveBudget(row,{...row.budget,entries:[...row.budget.entries,repaymentEntry(e,s,row,entry)]});
  db.prepare("INSERT INTO share_settlements(id,share_id,amount,state,paid_date,payment_entry,created_at) VALUES(?,?,?,'pending',?,?,?)").run(paymentId,id,body.amount,date,entryId,Date.now());
  return {expense:render(userId,e),snapshot};
 });}
 function receive(userId,id,body){return transact(userId,{...body,shareId:id,action:'receive'},()=>{
  const s=share(id),e=expense(s.expense_id);requireLedgerClient(e,body);
  if(e.owner_id!==userId)fail(404,'SHARE_NOT_FOUND','Share not found.');
  if(!['invited','accepted','declined'].includes(s.state)||body.confirmReceived!==true)fail(400,'PAYMENT_CONFIRMATION','Confirm that you received this money and have not already recorded it.');
  groups.assertUnlocked([s.id]);const remaining=Math.max(0,s.amount-s.refunded-groups.offsetForShare(s.id)-settlements(id).reduce((n,p)=>n+p.amount,0));
  if(!amount(body.amount)||body.amount>remaining)fail(400,'REPAYMENT_AMOUNT','Enter an amount within the unpaid share. Confirm any pending repayment instead of recording it again.');
  const row=ownedBudget(userId,e.budget_id,body.expectedRevision),original=row.budget.entries.find(x=>x.id===e.entry_id),account=row.budget.accounts.find(a=>a.id===body.accountId);
  if(!original||!account||!isCashAccount(account))fail(400,'RECEIVING_ACCOUNT','Choose the bank or cash account that received the money.');
  const date=body.date;if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>today()||date<e.purchase_date)fail(400,'RECEIVED_DATE','Choose the date received, from the purchase date through today.');
  const settlementId=randomUUID(),entryId=randomUUID();
  const entry={id:entryId,kind:'refund',amount:body.amount,date,accountId:account.id,categoryId:original.categoryId,refundOf:original.id,reimbursement:true,sharedSettlementId:settlementId,payee:(s.name||s.email||'Former member').slice(0,160),note:'Reimbursement for '+e.merchant,cleared:false};
  const snapshot=saveBudget(row,{...row.budget,entries:[...row.budget.entries,receivedEntry(e,s,entry)]});
  db.prepare("INSERT INTO share_settlements(id,share_id,amount,state,paid_date,payment_entry,received_entry,created_at,payer_recorded) VALUES(?,?,?,'confirmed',?,'',?,?,1)").run(settlementId,id,body.amount,date,entryId,Date.now());
  return {expense:render(userId,e),snapshot};
 });}
 function recordReceivedPayment(userId,id,body){return transact(userId,{...body,settlementId:id,action:'record-received-payment'},()=>{
  const payment=db.prepare('SELECT * FROM share_settlements WHERE id=?').get(id);if(!payment)fail(404,'PAYMENT_NOT_FOUND','Repayment not found.');
  const s=share(payment.share_id),e=expense(s.expense_id);requireLedgerClient(e,body);
  if(s.recipient_id!==userId)fail(404,'PAYMENT_NOT_FOUND','Repayment not found.');
  if(s.state!=='accepted'||payment.state!=='confirmed'||!payment.payer_recorded||payment.payment_entry||body.confirmPaid!==true)fail(409,'PAYMENT_ALREADY_RECORDED','Accept the share first and only add a payment you made that is not already in your budget.');
  groups.assertUnlocked([s.id]);const row=ownedBudget(userId,s.budget_id,body.expectedRevision),account=row.budget.accounts.find(a=>a.id===body.accountId);
  if(!account||!isCashAccount(account)||(e.ledger_version<2&&!row.budget.categories.some(c=>c.id===body.categoryId)))fail(400,'REPAYMENT_ACCOUNT','Choose the account and category you paid from.');
  if(row.budget.currency!==e.currency)fail(409,'SHARE_CURRENCY','This budget’s currency changed.');
  const date=body.date;if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>payment.paid_date||date<e.purchase_date)fail(400,'REPAYMENT_DATE','Choose the date paid, from the purchase date through the date received.');
  const entryId=randomUUID(),entry={id:entryId,kind:'expense',amount:payment.amount,date,accountId:account.id,categoryId:body.categoryId,sharedSettlementId:payment.id,payee:profile(e.owner_id).email.slice(0,160),note:'Repayment for '+e.merchant,cleared:false};
  const snapshot=saveBudget(row,{...row.budget,entries:[...row.budget.entries,repaymentEntry(e,s,row,entry)]});
  db.prepare('UPDATE share_settlements SET payment_entry=? WHERE id=?').run(entryId,id);
  return {expense:render(userId,e),snapshot};
 });}
 function confirm(userId,id,body){return transact(userId,{...body,settlementId:id},()=>{
  const payment=db.prepare('SELECT * FROM share_settlements WHERE id=?').get(id);if(!payment)fail(404,'PAYMENT_NOT_FOUND','Repayment not found.');
  const s=share(payment.share_id),e=expense(s.expense_id);requireLedgerClient(e,body);if(e.owner_id!==userId)fail(404,'PAYMENT_NOT_FOUND','Repayment not found.');
  groups.assertUnlocked([s.id]);if(payment.state==='reversed')fail(409,'PAYMENT_REVERSED','This repayment was reversed.');
  if(payment.state==='confirmed')fail(409,'PAYMENT_CONFIRMED','This repayment is already confirmed.');
  if(body.action==='dispute'){if(payment.state==='disputed')fail(409,'PAYMENT_ALREADY_DISPUTED','This repayment is already awaiting review.');db.prepare("UPDATE share_settlements SET state='disputed' WHERE id=?").run(id);return {expense:render(userId,e)};}
  if(body.action!=='confirm'||body.confirmReceived!==true)fail(400,'RECEIPT_CONFIRMATION','Confirm that you received this money first.');
  const row=ownedBudget(userId,e.budget_id,body.expectedRevision),original=row.budget.entries.find(x=>x.id===e.entry_id),account=row.budget.accounts.find(a=>a.id===body.accountId);
  if(!original||!account||!isCashAccount(account))fail(400,'RECEIVING_ACCOUNT','Choose the cash account that received the repayment.');
  const date=body.date;if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>today()||date<payment.paid_date)fail(400,'RECEIVED_DATE','Choose the date received, from the repayment date through today.');
  const entryId=randomUUID(),entry={id:entryId,kind:'refund',amount:payment.amount,date,accountId:account.id,categoryId:original.categoryId,refundOf:original.id,reimbursement:true,sharedSettlementId:payment.id,payee:(s.name||s.email||'Former member').slice(0,160),note:'Reimbursement for '+e.merchant,cleared:false};
  const snapshot=saveBudget(row,{...row.budget,entries:[...row.budget.entries,receivedEntry(e,s,entry)]});
  db.prepare("UPDATE share_settlements SET state='confirmed',received_entry=? WHERE id=?").run(entryId,id);
  return {expense:render(userId,e),snapshot};
 });}
 function assertBudgetChange(userId,budgetId,before,after,internal=false){
  if(before.currency!==after.currency&&db.prepare("SELECT 1 FROM expense_group_members m JOIN expense_groups g ON g.id=m.group_id WHERE m.user_id=? AND m.budget_id=? AND m.state='active' AND g.state='active'").get(userId,budgetId))fail(409,'SHARE_CURRENCY','This budget belongs to an active group. Keep its group currency or use a separate budget.');
  const owned=db.prepare('SELECT * FROM shared_expenses WHERE budget_id=? AND owner_id=?').all(budgetId,userId);
  if(after.version<before.version)fail(409,'UPDATE_REQUIRED','Update SpentOn to keep this budget’s shared accounting.');
  if(!internal)for(const e of owned){
   const active=shares(e.id).filter(s=>s.state!=='cancelled'&&(e.ledger_version>=2||s.state!=='declined'));if(!active.length&&e.ledger_version<2)continue;
   const prior=before.entries.find(x=>x.id===e.entry_id),next=after.entries.find(x=>x.id===e.entry_id);
   if(financial(prior)!==financial(next)||before.currency!==after.currency)fail(409,'SHARED_PURCHASE_LOCKED','This purchase is shared. Its amount, account, category and date must stay consistent with the accepted shares.');
   const externalRefunds=after.entries.filter(x=>x.refundOf===e.entry_id&&!x.sharedSettlementId).reduce((n,x)=>n+x.amount,0);
   if(externalRefunds+active.reduce((n,s)=>n+s.amount,0)>e.total)fail(409,'SHARED_REFUND_LIMIT','This refund would use money owed in a shared expense. Resolve the shared requests first.');
  }
  if(before.currency!==after.currency&&db.prepare("SELECT 1 FROM expense_shares WHERE recipient_id=? AND budget_id=? AND state='accepted'").get(userId,budgetId))fail(409,'SHARE_CURRENCY','This budget has accepted shares in its current currency.');
  if(!internal)for(const prior of before.entries.filter(e=>e.sharedExpenseId||e.sharedShareId||e.sharedSettlementId)){
   if(financial(prior)!==financial(after.entries.find(e=>e.id===prior.id)))fail(409,'SETTLEMENT_LOCKED','This entry records a shared repayment. It cannot be changed independently of the other person’s confirmation.');
  }
  if(!internal&&after.entries.some(e=>(e.sharedExpenseId||e.sharedShareId||e.sharedSettlementId||e.sharedAmount!==undefined||e.sharedReduction!==undefined||e.againstExpenseId||e.reversalOf)&&!before.entries.some(p=>p.id===e.id&&financial(p)===financial(e))))fail(400,'SETTLEMENT_ACTION_REQUIRED','Record shared repayments from People.');
 }
 let changedBudgets=new Map();
 let people;
 const groups=createSharedGroups(db,{fail,uuid,amount,hash,profile,verified,ownedBudget,expense,shares,settlements,render,saveBudget,transact,requireEditing,origin,people:()=>people});
 people=createPeopleService(db,{operations,profile,requireEditing,fail,uuid,hash});
 return {groups,people,receive,recordReceivedPayment,invite,previewInvitation,claimInvitation,sharedReceipt,list,get:(userId,id)=>{verified(userId);return render(userId,expense(id));},create,respond,repay,confirm,assertBudgetChange};
}
