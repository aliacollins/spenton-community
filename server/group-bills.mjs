import {randomUUID} from 'node:crypto';
import {calculate,today,validateBudget} from '../src/engine.ts';
import {planGroupBill,billOccurrence,isBillDate} from '../src/group-bill-plan.ts';

const json=value=>JSON.parse(value);
const title=value=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=160&&!/[<>\u0000-\u001f\u007f]/.test(value);
export function createGroupBills(db,c){
 const {fail,verified,ownedBudget,saveBudget,transact,requireEditing,member,members,getGroup,expenseSummary,assertUnlocked,touchExpense}=c;
 db.exec(`CREATE TABLE IF NOT EXISTS group_bill_series(id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES expense_groups(id),creator_id TEXT REFERENCES users(id) ON DELETE SET NULL,state TEXT NOT NULL,revision INTEGER NOT NULL,merchant TEXT NOT NULL,definition TEXT NOT NULL,schedule TEXT NOT NULL,next_index INTEGER NOT NULL,created_at INTEGER NOT NULL) STRICT;
 CREATE TABLE IF NOT EXISTS group_bill_plans(id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES expense_groups(id),creator_id TEXT REFERENCES users(id) ON DELETE SET NULL,state TEXT NOT NULL,revision INTEGER NOT NULL,merchant TEXT NOT NULL,purchase_date TEXT NOT NULL,plan TEXT NOT NULL,series_id TEXT REFERENCES group_bill_series(id),occurrence_date TEXT,created_at INTEGER NOT NULL,UNIQUE(series_id,occurrence_date)) STRICT;
 CREATE TABLE IF NOT EXISTS group_bill_approvals(bill_id TEXT NOT NULL REFERENCES group_bill_plans(id) ON DELETE CASCADE,member_id TEXT NOT NULL REFERENCES expense_group_members(id),budget_revision INTEGER NOT NULL,account_id TEXT NOT NULL,category_id TEXT NOT NULL,PRIMARY KEY(bill_id,member_id)) STRICT;
 CREATE TABLE IF NOT EXISTS group_bill_parts(bill_id TEXT NOT NULL REFERENCES group_bill_plans(id),member_id TEXT NOT NULL REFERENCES expense_group_members(id),expense_id TEXT NOT NULL UNIQUE,PRIMARY KEY(bill_id,member_id)) STRICT;
 CREATE INDEX IF NOT EXISTS group_bill_plans_group ON group_bill_plans(group_id,created_at);
 CREATE INDEX IF NOT EXISTS group_bill_series_group ON group_bill_series(group_id,state);`);
 const read=id=>{const bill=db.prepare('SELECT * FROM group_bill_plans WHERE id=?').get(id??'');if(!bill)fail(404,'GROUP_BILL_NOT_FOUND','Group bill not found.');return bill;};
 const readSeries=id=>{const row=db.prepare('SELECT * FROM group_bill_series WHERE id=?').get(id??'');if(!row)fail(404,'GROUP_SERIES_NOT_FOUND','Scheduled group bill not found.');return row;};
 function budgetFor(userId,groupId,revision){
  const me=member(userId,groupId),row=db.prepare('SELECT revision FROM budgets WHERE id=? AND owner_id=?').get(me.budget_id??'',userId);
  const owned=ownedBudget(userId,me.budget_id,revision??row?.revision);
  if(owned.budget.currency!==getGroup(groupId).currency)fail(400,'GROUP_CURRENCY','Use the currency this group was created in.');
  return owned;
 }
 function active(groupId){const g=getGroup(groupId);if(g.state!=='active')fail(409,'GROUP_ARCHIVED','This group is archived.');return g;}
 function checkGroupRevision(groupId,revision){const g=active(groupId);if(!Number.isSafeInteger(revision)||revision<1||revision>g.revision)fail(409,'GROUP_CHANGED','Review this group before adding a bill.');}
 function validatePlan(groupId,input){
  let plan;try{plan=planGroupBill(input);}catch(error){fail(400,'GROUP_SPLIT',error.message);}
  const roster=members(groupId);
  if(plan.people.some(p=>!roster.some(m=>m.id===p.memberId&&m.state!=='removed')))fail(400,'GROUP_PARTICIPANT','Choose people in this group.');
  if(plan.payers.some(p=>!roster.some(m=>m.id===p.memberId&&m.state==='active'&&m.user_id&&m.budget_id)))fail(400,'GROUP_PAYER','Each payer must join the group and choose a budget first.');
  if(new Set([...plan.people.map(p=>p.memberId),...plan.payers.map(p=>p.memberId)]).size<2)fail(400,'GROUP_PARTICIPANT','A group bill needs at least two people.');
  return plan;
 }
 function currentParts(bill){
  return db.prepare('SELECT * FROM group_bill_parts WHERE bill_id=?').all(bill.id).map(part=>{
   const expense=db.prepare('SELECT * FROM shared_expenses WHERE id=?').get(part.expense_id);
   const saved=db.prepare('SELECT document FROM group_ledger_archive WHERE id=?').get(part.expense_id);
   let summary=expense?expenseSummary(expense):saved?json(saved.document):null;
   if(expense&&saved){const old=json(saved.document),ids=new Set(summary.shares.map(s=>s.id));summary={...summary,shares:[...summary.shares,...old.shares.filter(s=>!ids.has(s.id))]};}
   return {memberId:part.member_id,expenseId:part.expense_id,summary};
  });
 }
 function approvals(bill){
  const roster=members(bill.group_id),valid=new Map();
  for(const a of db.prepare('SELECT * FROM group_bill_approvals WHERE bill_id=?').all(bill.id)){
   const person=roster.find(m=>m.id===a.member_id&&m.state==='active');
   const row=person&&db.prepare('SELECT revision FROM budgets WHERE id=? AND owner_id=?').get(person.budget_id,person.user_id);
   if(row?.revision===a.budget_revision)valid.set(a.member_id,a);
  }return valid;
 }
 function pendingShares(userId,bill){
  return db.prepare("SELECT s.*,e.merchant,e.purchase_date,e.id bill_expense FROM group_bill_parts p JOIN shared_expenses e ON e.id=p.expense_id JOIN expense_shares s ON s.expense_id=e.id WHERE p.bill_id=? AND s.recipient_id=? AND s.state='invited' ORDER BY e.created_at,e.id,s.id").all(bill.id,userId);
 }
 function changes(userId,bill,choices={}){
  const me=member(userId,bill.group_id),plan=json(bill.plan),contribution=plan.payers.find(p=>p.memberId===me.id);
  if(bill.state==='pending'&&!contribution)return null;
  const pending=bill.state==='recorded'?pendingShares(userId,bill):[];
  if(bill.state==='recorded'&&!pending.length)return null;
  if(!['pending','recorded'].includes(bill.state))return null;
  const row=budgetFor(userId,bill.group_id,choices.expectedRevision);
  const previous=db.prepare('SELECT * FROM group_bill_approvals WHERE bill_id=? AND member_id=?').get(bill.id,me.id);
  const accountId=choices.accountId??previous?.account_id??row.budget.accounts.find(a=>a.type==='checking')?.id??row.budget.accounts.find(a=>a.type!=='investment')?.id??'';
  const categoryId=choices.categoryId??previous?.category_id??row.budget.categories.find(a=>a.icon===(getGroup(bill.group_id).kind==='trip'?'plane':'basket'))?.id??row.budget.categories[0]?.id??'';
  if(!row.budget.categories.some(a=>a.id===categoryId))fail(400,'SHARE_CATEGORY','Choose your category.');
  if(bill.state==='pending'&&!row.budget.accounts.some(a=>a.id===accountId&&a.type!=='investment'))fail(400,'GROUP_BILL_ACCOUNT','Choose the account you paid from.');
  const entries=[];
  if(bill.state==='pending'){
   entries.push({id:contribution.entryId,kind:'expense',amount:contribution.amount,date:bill.purchase_date,accountId,categoryId,payee:bill.merchant,note:'Your payment for this group expense.',cleared:false,sharedExpenseId:contribution.expenseId,sharedAmount:contribution.parts.filter(p=>p.memberId!==me.id).reduce((n,p)=>n+p.amount,0)});
   for(const payer of plan.payers)if(payer.memberId!==me.id){
    const part=payer.parts.find(p=>p.memberId===me.id);
    if(part?.amount)entries.push({id:part.entryId,kind:'shared_charge',amount:part.amount,date:bill.purchase_date,categoryId,sharedExpenseId:payer.expenseId,sharedShareId:part.shareId,payee:bill.merchant,note:'Your share of this group bill.',cleared:true});
   }
  }else for(const share of pending){
   assertUnlocked([share.id]);
   const amount=share.amount-share.refunded;
   if(amount>0)entries.push({id:randomUUID(),kind:'shared_charge',amount,date:share.purchase_date,categoryId,sharedExpenseId:share.bill_expense,sharedShareId:share.id,payee:share.merchant,note:'Your share of this group bill.',cleared:true});
  }
  let budget;try{budget=validateBudget({...row.budget,version:3,entries:[...row.budget.entries,...entries]});}catch(error){fail(400,'GROUP_BILL_BUDGET',error.message);}
  const before=calculate(row.budget,today().slice(0,7)),after=calculate(budget,today().slice(0,7));
  const totals=t=>({cash:t.cash,spent:t.spent,ready:t.ready,receivable:t.shared.receivable,owed:t.shared.owed,reserved:t.shared.reserved});
  return {row,budget,pending,accountId,categoryId,preview:{budgetId:row.id,budgetName:row.budget.name,revision:row.revision,currency:row.budget.currency,accountId,categoryId,before:totals(before),after:totals(after)}};
 }
 function view(userId,bill,withPreview=false,choices={}){
  const me=member(userId,bill.group_id),roster=members(bill.group_id),plan=json(bill.plan),approved=approvals(bill),parts=currentParts(bill);
  const costs=new Map(plan.people.map(p=>[p.memberId,p.amount]));
  if(bill.state==='recorded'){
   for(const key of costs.keys())costs.set(key,0);
   for(const {memberId,summary:e} of parts)if(e){
    costs.set(memberId,(costs.get(memberId)??0)+e.total-e.refunded-e.shares.filter(s=>s.state!=='cancelled').reduce((n,s)=>n+s.amount-s.refunded,0));
    for(const s of e.shares)if(s.state!=='cancelled')costs.set(s.memberId,(costs.get(s.memberId)??0)+s.amount-s.refunded);
   }
  }
  let own=null,problem=null;
  if(withPreview)try{own=changes(userId,bill,choices)?.preview??null;}catch(error){problem=error.message;}
  return {id:bill.id,groupId:bill.group_id,groupName:getGroup(bill.group_id).name,budgetId:me.budget_id,merchant:bill.merchant,date:bill.purchase_date,currency:getGroup(bill.group_id).currency,state:bill.state,revision:bill.revision,scheduledDate:bill.occurrence_date,refunded:parts.reduce((n,p)=>n+(p.summary?.refunded??0),0),method:plan.method,originalTotal:plan.total,total:bill.state==='recorded'?parts.reduce((n,p)=>n+(p.summary?p.summary.total-p.summary.refunded:0),0):plan.total,
   people:[...costs].map(([memberId,amount])=>({memberId,name:roster.find(m=>m.id===memberId)?.name??'Former member',amount,isYou:me.id===memberId})),
   payers:plan.payers.map(p=>{const part=parts.find(a=>a.memberId===p.memberId);return {memberId:p.memberId,name:roster.find(m=>m.id===p.memberId)?.name??'Former member',amount:part?.summary?.total??p.amount,isYou:p.memberId===me.id,approved:bill.state==='recorded'||approved.has(p.memberId),expenseId:part?.expenseId,canOpen:!!part?.summary&&!part.summary.archived&&(p.memberId===me.id||part.summary.shares.some(s=>s.memberId===me.id))};}),
   canConfirm:bill.state==='pending'&&plan.payers.some(p=>p.memberId===me.id)&&!approved.has(me.id),canCancel:bill.state==='pending'&&(bill.creator_id===userId||plan.payers.some(p=>p.memberId===me.id)),canAccept:bill.state==='recorded'&&pendingShares(userId,bill).length>0,own,problem,seriesId:bill.series_id};
 }
 function make(userId,groupId,body,series=null){
  member(userId,groupId);active(groupId);
  if(body.billVersion!==1)fail(426,'UPDATE_REQUIRED','Update SpentOn before adding this bill.');
  if(!title(body.merchant)||!isBillDate(body.date)||body.date>today())fail(400,'GROUP_BILL_DETAILS','Enter the bill description and the date it was paid.');
  const plan=validatePlan(groupId,body);
  if(db.prepare('SELECT count(*) n FROM shared_expenses WHERE group_id=?').get(groupId).n+plan.payers.length>1000)fail(409,'GROUP_BILL_LIMIT','This group has reached its bill limit.');
  if(db.prepare('SELECT count(*) n FROM group_bill_plans WHERE group_id=?').get(groupId).n>=1000)fail(409,'GROUP_BILL_LIMIT','This group has reached its bill limit.');
  if(db.prepare("SELECT count(*) n FROM group_bill_plans WHERE creator_id=? AND state='pending'").get(userId).n>=20)fail(409,'GROUP_REVIEW_LIMIT','Complete or cancel an existing bill review first.');
  const stored={...plan,payers:plan.payers.map(p=>({...p,entryId:randomUUID(),expenseId:randomUUID(),parts:p.parts.map(s=>({...s,shareId:randomUUID(),entryId:randomUUID()}))}))},id=randomUUID();
  db.prepare("INSERT INTO group_bill_plans VALUES(?,?,?,'pending',1,?,?,?,?,?,?)").run(id,groupId,userId,body.merchant.trim(),body.date,JSON.stringify(stored),series?.id??null,series?series.occurrenceDate??body.date:null,Date.now());
  db.prepare('UPDATE expense_groups SET revision=revision+1 WHERE id=?').run(groupId);
  return {bill:view(userId,read(id),true)};
 }
 function create(userId,body){return transact(userId,{...body,action:'group-bill-create'},()=>{
  checkGroupRevision(body.groupId,body.expectedGroupRevision);const created=make(userId,body.groupId,body);return body.confirmPaid===true?confirmBody(userId,created.bill.id,{...body,expectedBillRevision:created.bill.revision}):created;
 });}
 function confirm(userId,id,body){return transact(userId,{...body,billId:id,action:'group-bill-confirm'},()=>confirmBody(userId,id,body));}
 function confirmBody(userId,id,body){
  const bill=read(id),me=member(userId,bill.group_id);active(bill.group_id);
  if(body.expectedBillRevision!==bill.revision)fail(409,'GROUP_BILL_CHANGED','This bill changed. Review it again.');
  const plan=json(bill.plan);
  if(bill.state!=='pending')fail(409,'GROUP_BILL_CHANGED','This bill has already been recorded or cancelled.');
  if(body.decision==='cancel'){
   if(bill.creator_id!==userId&&!plan.payers.some(p=>p.memberId===me.id))fail(403,'GROUP_BILL_PAYER','Only the creator or a payer can cancel this request.');
   db.prepare("UPDATE group_bill_plans SET state='cancelled',revision=revision+1 WHERE id=?").run(id);db.prepare('DELETE FROM group_bill_approvals WHERE bill_id=?').run(id);return {bill:view(userId,read(id))};
  }
  if(body.confirmPaid!==true||body.billVersion!==1||!Number.isSafeInteger(body.expectedRevision)||typeof body.accountId!=='string'||typeof body.categoryId!=='string'||!plan.payers.some(p=>p.memberId===me.id))fail(400,'GROUP_BILL_CONFIRM','Confirm only the amount you paid and your reviewed budget changes.');
  validatePlan(bill.group_id,plan);
  const own=changes(userId,bill,body);
  db.prepare('INSERT INTO group_bill_approvals VALUES(?,?,?,?,?) ON CONFLICT(bill_id,member_id) DO UPDATE SET budget_revision=excluded.budget_revision,account_id=excluded.account_id,category_id=excluded.category_id').run(id,me.id,own.row.revision,own.accountId,own.categoryId);
  const accepted=approvals(bill);
  let snapshot;
  if(plan.payers.every(p=>accepted.has(p.memberId))){
   if(db.prepare('SELECT count(*) n FROM shared_expenses WHERE group_id=?').get(bill.group_id).n+plan.payers.length>1000)fail(409,'GROUP_BILL_LIMIT','This group has reached its bill limit.');
   const roster=members(bill.group_id),rows=[];
   for(const payer of plan.payers){
    const person=roster.find(m=>m.id===payer.memberId),a=accepted.get(person.id);verified(person.user_id);requireEditing(person.user_id);
    const change=changes(person.user_id,bill,{expectedRevision:a.budget_revision,accountId:a.account_id,categoryId:a.category_id});rows.push({person,payer,change});
   }
   for(const {person,payer,change} of rows){
    if(db.prepare('SELECT count(*) n FROM shared_expenses WHERE owner_id=? AND created_at>?').get(person.user_id,Date.now()-86400000).n>=50)fail(429,'SHARE_LIMIT','A payer has reached today’s shared-expense limit.');
    db.prepare("INSERT INTO shared_expenses(id,owner_id,budget_id,entry_id,currency,total,merchant,purchase_date,created_at,ledger_version,group_id) VALUES(?,?,?,?,?,?,?,?,?,3,?)").run(payer.expenseId,person.user_id,change.row.id,payer.entryId,change.row.budget.currency,payer.amount,bill.merchant,bill.purchase_date,Date.now(),bill.group_id);
    db.prepare('INSERT INTO group_bill_parts VALUES(?,?,?)').run(id,person.id,payer.expenseId);
    for(const part of payer.parts)if(part.memberId!==person.id&&part.amount>0){
     const recipient=roster.find(m=>m.id===part.memberId),isPayer=plan.payers.some(p=>p.memberId===recipient.id);
     db.prepare('INSERT INTO expense_shares(id,expense_id,email,amount,state,recipient_id,budget_id,name,person_key,group_member_id) VALUES(?,?,?,?,?,?,?,?,?,?)').run(part.shareId,payer.expenseId,recipient.email,part.amount,isPayer?'accepted':'invited',recipient.user_id,isPayer?recipient.budget_id:null,recipient.name,recipient.id,recipient.id);
    }
   }
   for(const {person,change} of rows){const saved=saveBudget(change.row,change.budget);if(person.user_id===userId)snapshot=saved;}
   db.prepare("UPDATE group_bill_plans SET state='recorded',revision=revision+1 WHERE id=?").run(id);db.prepare('DELETE FROM group_bill_approvals WHERE bill_id=?').run(id);
   db.prepare('UPDATE expense_groups SET revision=revision+1 WHERE id=?').run(bill.group_id);
  }
  return {bill:view(userId,read(id),true),...(snapshot?{snapshot}:{})};
 }
 function accept(userId,id,body){return transact(userId,{...body,billId:id,action:'group-bill-accept'},()=>{
  const bill=read(id);member(userId,bill.group_id);active(bill.group_id);
  if(body.expectedBillRevision!==bill.revision)fail(409,'GROUP_BILL_CHANGED','This bill changed. Review the current amounts before continuing.');
  if(bill.state==='recorded'&&body.decision==='decline'){
   const pending=pendingShares(userId,bill);if(!pending.length)fail(409,'GROUP_BILL_CHANGED','No share is waiting for your response.');
   for(const share of pending){assertUnlocked([share.id]);db.prepare("UPDATE expense_shares SET state='declined' WHERE id=?").run(share.id);touchExpense(share.expense_id);}
   return {bill:view(userId,read(id))};
  }
  if(bill.state!=='recorded'||body.confirmShare!==true||body.billVersion!==1||!Number.isSafeInteger(body.expectedRevision)||typeof body.categoryId!=='string')fail(400,'GROUP_BILL_ACCEPT','Review your share before accepting this recorded bill.');
  const own=changes(userId,bill,body);
  if(!own)fail(409,'GROUP_BILL_CHANGED','No share is waiting for your acceptance.');
  const snapshot=saveBudget(own.row,own.budget);
  for(const share of own.pending){db.prepare("UPDATE expense_shares SET state='accepted',budget_id=? WHERE id=?").run(own.row.id,share.id);touchExpense(share.expense_id);}
  return {bill:view(userId,read(id)),snapshot};
 });}
 function seriesView(userId,row){
  member(userId,row.group_id);const schedule=json(row.schedule),definition=json(row.definition),next=billOccurrence(schedule,row.next_index);
  return {id:row.id,groupId:row.group_id,merchant:row.merchant,state:row.state,revision:row.revision,definition,schedule,nextDate:next,due:row.state==='active'&&!!next&&next<=today(),canManage:row.creator_id===userId};
 }
 function saveSeries(userId,body){return transact(userId,{...body,action:'group-series-create'},()=>{
  member(userId,body.groupId);checkGroupRevision(body.groupId,body.expectedGroupRevision);
  if(body.billVersion!==1||!title(body.merchant))fail(400,'GROUP_SERIES_DETAILS','Enter a description for this scheduled bill.');
  const plan=validatePlan(body.groupId,body);try{if(!billOccurrence(body.schedule,0))throw Error('Choose a future occurrence.');}catch(error){fail(400,'GROUP_SCHEDULE',error.message);}
  if(db.prepare("SELECT count(*) n FROM group_bill_series WHERE group_id=? AND state!='complete'").get(body.groupId).n>=50)fail(409,'GROUP_SERIES_LIMIT','This group has reached its schedule limit.');
  const id=randomUUID(),definition={total:plan.total,method:plan.method,people:plan.people.map(({memberId,value})=>({memberId,value})),payers:plan.payers.map(({memberId,amount})=>({memberId,amount}))};
  const schedule={start:body.schedule.start,interval:body.schedule.interval,every:body.schedule.every,...(body.schedule.until?{until:body.schedule.until}:{})};
  db.prepare("INSERT INTO group_bill_series VALUES(?,?,?,'active',1,?,?,?,0,?)").run(id,body.groupId,userId,body.merchant.trim(),JSON.stringify(definition),JSON.stringify(schedule),Date.now());
  return {series:seriesView(userId,readSeries(id))};
 });}
 function changeSeries(userId,id,body){return transact(userId,{...body,seriesId:id,action:'group-series-change'},()=>{
  const row=readSeries(id);member(userId,row.group_id);active(row.group_id);
  if(row.revision!==body.expectedSeriesRevision)fail(409,'GROUP_SERIES_CHANGED','This schedule changed. Reload it before continuing.');
  if(body.actionType==='create-occurrence'){
   const next=billOccurrence(json(row.schedule),row.next_index);
   if(row.state!=='active'||!next||next>today())fail(409,'GROUP_SERIES_NOT_DUE','This bill is not due yet.');
   if(db.prepare('SELECT 1 FROM group_bill_plans WHERE series_id=? AND occurrence_date=?').get(id,next))fail(409,'GROUP_SERIES_OCCURRENCE','This occurrence already has a bill. Review it or move the schedule to its next date.');
   const result=make(userId,row.group_id,{...json(row.definition),merchant:row.merchant,date:body.date??today(),billVersion:1},{...row,occurrenceDate:next});
   const following=billOccurrence(json(row.schedule),row.next_index+1);
   db.prepare('UPDATE group_bill_series SET next_index=next_index+1,revision=revision+1,state=? WHERE id=?').run(following?'active':'complete',id);
   return {...result,series:seriesView(userId,readSeries(id))};
  }
  if(row.creator_id!==userId)fail(403,'GROUP_SERIES_OWNER','Only the schedule creator can change future bills.');
  if(row.state==='complete')fail(409,'GROUP_SERIES_ENDED','This schedule has ended.');
  if(body.actionType==='pause'||body.actionType==='resume'){if(row.state==='complete')fail(409,'GROUP_SERIES_ENDED','This schedule has ended.');db.prepare('UPDATE group_bill_series SET state=?,revision=revision+1 WHERE id=?').run(body.actionType==='pause'?'paused':'active',id);}
  else if(body.actionType==='skip'){const next=billOccurrence(json(row.schedule),row.next_index+1);db.prepare('UPDATE group_bill_series SET next_index=next_index+1,state=?,revision=revision+1 WHERE id=?').run(next?'active':'complete',id);}
  else if(body.actionType==='edit'){
   if(row.state==='complete'||!title(body.merchant))fail(400,'GROUP_SERIES_DETAILS','Choose an active schedule and a bill description.');
   const plan=validatePlan(row.group_id,body);
   try{if(!billOccurrence(body.schedule,0))throw Error('Choose a valid next occurrence.');}catch(error){fail(400,'GROUP_SCHEDULE',error.message);}
   const definition={total:plan.total,method:plan.method,people:plan.people.map(({memberId,value})=>({memberId,value})),payers:plan.payers.map(({memberId,amount})=>({memberId,amount}))};
   const prior=json(row.schedule),keepAnchor=body.schedule.start===billOccurrence(prior,row.next_index)&&body.schedule.interval===prior.interval&&body.schedule.every===prior.every;
   const schedule={start:keepAnchor?prior.start:body.schedule.start,interval:body.schedule.interval,every:body.schedule.every,...(body.schedule.until?{until:body.schedule.until}:{})};
   db.prepare('UPDATE group_bill_series SET merchant=?,definition=?,schedule=?,next_index=?,revision=revision+1 WHERE id=?').run(body.merchant.trim(),JSON.stringify(definition),JSON.stringify(schedule),keepAnchor?row.next_index:0,id);
  }
  else if(body.actionType==='end')db.prepare("UPDATE group_bill_series SET state='complete',revision=revision+1 WHERE id=?").run(id);
  else fail(400,'GROUP_SERIES_ACTION','Choose a schedule action.');
  return {series:seriesView(userId,readSeries(id))};
 });}
 return {create,confirm,accept,summary:(userId,id)=>view(userId,read(id)),get:(userId,id,choices)=>view(userId,read(id),true,choices),list:(userId,groupId)=>{member(userId,groupId);return db.prepare('SELECT * FROM group_bill_plans WHERE group_id=? ORDER BY created_at DESC').all(groupId).map(b=>view(userId,b));},series:(userId,groupId)=>{member(userId,groupId);return db.prepare('SELECT * FROM group_bill_series WHERE group_id=? ORDER BY created_at DESC').all(groupId).map(s=>seriesView(userId,s));},saveSeries,changeSeries,hasPending:groupId=>!!db.prepare("SELECT 1 FROM group_bill_plans WHERE group_id=? AND state='pending'").get(groupId)};
}

export function erasePlannedBills(db,userId,groupId,memberIds){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='group_bill_plans'").get())return;
 for(const row of db.prepare('SELECT * FROM group_bill_plans WHERE group_id=?').all(groupId)){
  const plan=json(row.plan),affected=plan.payers.some(p=>memberIds.includes(p.memberId))||plan.people.some(p=>memberIds.includes(p.memberId));
  if(affected&&row.state==='pending'){db.prepare("UPDATE group_bill_plans SET state='cancelled',revision=revision+1 WHERE id=?").run(row.id);db.prepare('DELETE FROM group_bill_approvals WHERE bill_id=?').run(row.id);}
  if(row.creator_id===userId)db.prepare("UPDATE group_bill_plans SET creator_id=NULL,merchant='Shared bill from a former member' WHERE id=?").run(row.id);
 }
 for(const row of db.prepare('SELECT * FROM group_bill_series WHERE group_id=?').all(groupId)){
  const plan=json(row.definition);
  if(row.creator_id===userId||[...plan.people,...plan.payers].some(p=>memberIds.includes(p.memberId)))db.prepare("UPDATE group_bill_series SET state='complete',revision=revision+1,creator_id=CASE WHEN creator_id=? THEN NULL ELSE creator_id END WHERE id=?").run(userId,row.id);
 }
}
