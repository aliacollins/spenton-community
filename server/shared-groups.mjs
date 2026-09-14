import {randomUUID,randomBytes} from 'node:crypto';
import {calculate,effectiveEntries,today,validateBudget,proportionalAmounts} from '../src/engine.ts';
import {createGroupBills,erasePlannedBills} from './group-bills.mjs';

const clean=(value,max=100)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max&&!/[<>\u0000-\u001f\u007f]/.test(value);
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value&&value<=today();
const parse=row=>row?JSON.parse(row):null;

export function createSharedGroups(db,context){
 const {fail,uuid,amount,hash,profile,verified,ownedBudget,expense,shares,settlements,render,saveBudget,transact,requireEditing,origin}=context;
 db.exec(`CREATE TABLE IF NOT EXISTS expense_groups(id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL,currency TEXT NOT NULL,owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,state TEXT NOT NULL DEFAULT 'active',revision INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL) STRICT;
 CREATE TABLE IF NOT EXISTS expense_group_members(id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,user_id TEXT REFERENCES users(id) ON DELETE SET NULL,name TEXT NOT NULL,email TEXT,budget_id TEXT REFERENCES budgets(id) ON DELETE SET NULL,state TEXT NOT NULL,invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,token_hash TEXT UNIQUE,expires_at INTEGER,UNIQUE(group_id,user_id),UNIQUE(group_id,email)) STRICT;
 CREATE TABLE IF NOT EXISTS shared_changes(id TEXT PRIMARY KEY,group_id TEXT REFERENCES expense_groups(id) ON DELETE CASCADE,kind TEXT NOT NULL,initiator_id TEXT REFERENCES users(id) ON DELETE SET NULL,state TEXT NOT NULL,reason TEXT NOT NULL,payload TEXT NOT NULL,participants TEXT NOT NULL,approvals TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL) STRICT;
 CREATE TABLE IF NOT EXISTS shared_change_targets(change_id TEXT NOT NULL REFERENCES shared_changes(id) ON DELETE CASCADE,share_id TEXT NOT NULL REFERENCES expense_shares(id) ON DELETE CASCADE,PRIMARY KEY(change_id,share_id)) STRICT;
 CREATE TABLE IF NOT EXISTS share_offsets(id TEXT PRIMARY KEY,change_id TEXT REFERENCES shared_changes(id) ON DELETE SET NULL,first_share TEXT NOT NULL REFERENCES expense_shares(id) ON DELETE CASCADE,second_share TEXT NOT NULL REFERENCES expense_shares(id) ON DELETE CASCADE,amount INTEGER NOT NULL,state TEXT NOT NULL) STRICT;
 CREATE TABLE IF NOT EXISTS group_ledger_archive(id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES expense_groups(id) ON DELETE CASCADE,document TEXT NOT NULL) STRICT;`);
 const column=(table,name,definition)=>{if(!db.prepare('PRAGMA table_info('+table+')').all().some(c=>c.name===name))db.exec('ALTER TABLE '+table+' ADD COLUMN '+name+' '+definition);};
 column('shared_expenses','group_id','TEXT REFERENCES expense_groups(id)');
 column('shared_expenses','kind',"TEXT NOT NULL DEFAULT 'purchase'");
 column('shared_expenses','refunded_total','INTEGER NOT NULL DEFAULT 0');
 column('shared_expenses','revision','INTEGER NOT NULL DEFAULT 1');
 column('shared_expenses','source_expense_id','TEXT REFERENCES shared_expenses(id) ON DELETE SET NULL');
 column('expense_shares','group_member_id','TEXT REFERENCES expense_group_members(id)');
 column('expense_shares','refunded','INTEGER NOT NULL DEFAULT 0');
 column('expense_group_members','person_key','TEXT');

 db.exec('CREATE INDEX IF NOT EXISTS grouped_expenses ON shared_expenses(group_id); CREATE INDEX IF NOT EXISTS grouped_members_user ON expense_group_members(user_id,state); CREATE INDEX IF NOT EXISTS grouped_members_email ON expense_group_members(email,state); CREATE INDEX IF NOT EXISTS grouped_changes ON shared_changes(group_id,state); CREATE INDEX IF NOT EXISTS grouped_review_targets ON shared_change_targets(share_id);');
 const getGroup=id=>{const group=db.prepare('SELECT * FROM expense_groups WHERE id=?').get(id??'');if(!group)fail(404,'GROUP_NOT_FOUND','Group not found.');return group;};
 const members=id=>db.prepare('SELECT * FROM expense_group_members WHERE group_id=? ORDER BY rowid').all(id);
 function member(userId,id){verified(userId);const found=db.prepare("SELECT * FROM expense_group_members WHERE group_id=? AND user_id=? AND state='active'").get(id,userId);if(!found)fail(404,'GROUP_NOT_FOUND','Group not found.');return found;}
 const offsetForShare=id=>db.prepare("SELECT COALESCE(sum(amount),0) value FROM share_offsets WHERE state='active' AND (first_share=? OR second_share=?)").get(id,id).value;
 const pendingForShare=(userId,id)=>{const rows=db.prepare("SELECT c.id,c.participants FROM shared_changes c JOIN shared_change_targets t ON t.change_id=c.id WHERE t.share_id=? AND c.state='pending'").all(id);return {reviewPending:rows.length>0,pendingChangeId:rows.find(c=>parse(c.participants).includes(userId))?.id};};
 const outstanding=s=>Math.max(0,s.amount-s.refunded-offsetForShare(s.id)-settlements(s.id).reduce((n,p)=>n+p.amount,0));
 function assertUnlocked(ids,except=''){
  for(const id of ids){if(db.prepare("SELECT 1 FROM shared_change_targets t JOIN shared_changes c ON c.id=t.change_id WHERE t.share_id=? AND c.state='pending' AND c.id!=?").get(id,except))fail(409,'SHARE_REVIEW_PENDING','This bill has a change awaiting review. Complete or cancel that review first.');}
 }
 function mutateGroup(id,revision){const group=getGroup(id);if(group.state!=='active')fail(409,'GROUP_ARCHIVED','This group is archived. Its history remains available.');if(!Number.isSafeInteger(revision)||group.revision!==revision)fail(409,'GROUP_CHANGED','This group changed. Reload it and review your action again.');return group;}
 function groupList(userId){
  const p=verified(userId);
  const rows=db.prepare("SELECT DISTINCT g.* FROM expense_groups g JOIN expense_group_members m ON m.group_id=g.id WHERE m.user_id=? OR (m.state='invited' AND m.email=?) ORDER BY g.created_at DESC").all(userId,p.email.toLowerCase());
  return {available:true,version:1,changes:allChanges(userId),groups:rows.map(g=>{const m=members(g.id).find(m=>m.user_id===userId||(m.state==='invited'&&m.email===p.email.toLowerCase()));return {id:g.id,name:g.name,kind:g.kind,currency:g.currency,state:g.state,revision:g.revision,membership:m.state,memberCount:members(g.id).length,invitationId:m.state==='invited'?m.id:undefined};})};
 }
 function expenseSummary(e){
  const roster=members(e.group_id),payer=roster.find(m=>m.user_id===e.owner_id);
  return {id:e.id,parentBillId:db.prepare('SELECT bill_id FROM group_bill_parts WHERE expense_id=?').get(e.id)?.bill_id,kind:e.kind,merchant:e.merchant,date:e.purchase_date,total:e.total,refunded:e.refunded_total,payerId:payer?.id??null,revision:e.revision,hasReceipt:!!db.prepare('SELECT 1 FROM shared_receipts WHERE expense_id=?').get(e.id),archived:false,
   shares:shares(e.id).map(s=>({id:s.id,memberId:s.group_member_id,amount:s.amount,refunded:s.refunded,confirmed:settlements(s.id).filter(p=>p.state==='confirmed').reduce((n,p)=>n+p.amount,0),pending:settlements(s.id).filter(p=>p.state!=='confirmed').reduce((n,p)=>n+p.amount,0),offset:offsetForShare(s.id),state:s.state}))};
 }
 function groupDetail(userId,id){
  const me=member(userId,id),g=getGroup(id),roster=members(id),live=db.prepare('SELECT * FROM shared_expenses WHERE group_id=? ORDER BY purchase_date DESC,created_at DESC').all(id);
  const archived=db.prepare('SELECT document FROM group_ledger_archive WHERE group_id=?').all(id).map(row=>parse(row.document)),liveIds=new Set(live.map(e=>e.id));
  const bills=[...live.map(e=>{const summary=expenseSummary(e),saved=archived.find(a=>a.id===e.id);if(saved){const ids=new Set(summary.shares.map(s=>s.id));summary.shares.push(...saved.shares.filter(s=>!ids.has(s.id)));summary.hasRemovedMember=true;}return summary;}),...archived.filter(e=>!liveIds.has(e.id))].sort((a,b)=>b.date.localeCompare(a.date));
  const balances=roster.map(m=>({memberId:m.id,name:m.name,paid:0,share:0,owed:0,owing:0,pending:0})),byId=new Map(balances.map(b=>[b.memberId,b]));
  for(const e of bills){
   const payer=byId.get(e.payerId);if(!payer)continue;
   if(e.kind==='purchase'){payer.paid+=e.total-e.refunded;payer.share+=e.total-e.refunded-e.shares.filter(s=>s.state!=='cancelled').reduce((n,s)=>n+s.amount-s.refunded,0);}
   for(const s of e.shares){if(s.state==='cancelled')continue;const recipient=byId.get(s.memberId);if(!recipient)continue;const remaining=Math.max(0,s.amount-s.refunded-s.confirmed-s.offset);if(e.kind==='purchase')recipient.share+=s.amount-s.refunded;payer.owed+=remaining;recipient.owing+=remaining;recipient.pending+=s.pending;}
  }
  if(balances.some(b=>[b.paid,b.share,b.owed,b.owing,b.pending].some(n=>!Number.isSafeInteger(n))))fail(409,'GROUP_TOTAL_LIMIT','This group exceeds the supported amount. Review the individual bills.');
  return {id:g.id,name:g.name,kind:g.kind,currency:g.currency,state:g.state,revision:g.revision,memberId:me.id,budgetId:me.budget_id,canManage:g.owner_id===userId,total:balances.reduce((n,b)=>n+b.paid,0),members:roster.map(m=>({id:m.id,name:m.name,state:m.state,isYou:m.user_id===userId,personKey:context.people?.()?.canonical(userId,m.id)?.id,email:m.user_id===userId||m.invited_by===userId?m.email:undefined})),balances,bills,changes:changesFor(userId,id),settlements:pairBalances(userId,id),billVersion:1,combinedBills:groupBills.list(userId,id),series:groupBills.series(userId,id)};
 }
 function addMember(userId,groupId,input){
  if(!input||typeof input!=='object'||!clean(input.name)||input.email&&(!/^\S+@[^\s@]+\.[^\s@]+$/.test(input.email)||input.email.length>254))fail(400,'GROUP_MEMBER','Enter a name and an optional valid email.');
  let email=input.email?.trim().toLowerCase()||null;
  if(members(groupId).length>=20)fail(400,'GROUP_MEMBER_LIMIT','A group can have up to 20 members.');
  if(email&&members(groupId).some(m=>m.email===email))fail(409,'GROUP_MEMBER_EXISTS','This person is already in the group.');
  const contact=context.people?.()?.resolve(userId,input);
  email=contact?.email??email;
  if(contact&&members(groupId).some(m=>m.person_key===contact.person_key||(email&&m.email===email)))fail(409,'GROUP_MEMBER_EXISTS','This person is already in the group.');
  const id=randomUUID();db.prepare("INSERT INTO expense_group_members(id,group_id,name,email,state,invited_by,person_key) VALUES(?,?,?,?,'invited',?,?)").run(id,groupId,contact?.name??input.name.trim(),email,userId,contact?.person_key??null);return id;
 }
 function createGroup(userId,body){return transact(userId,{...body,action:'group-create'},()=>{
  const p=verified(userId),row=ownedBudget(userId,body.budgetId,body.expectedRevision);
  if(!clean(body.name,80)||!['household','trip','event'].includes(body.kind)||!Array.isArray(body.members)||body.members.length>19)fail(400,'GROUP_DETAILS','Choose a group name, type and up to 19 other people.');
  if(!clean(body.yourName))fail(400,'GROUP_NAME','Enter the name people in this group will see.');
  if(db.prepare('SELECT count(*) n FROM expense_group_members WHERE user_id=?').get(userId).n>=100)fail(409,'GROUP_LIMIT','You have reached the group limit.');
  const id=randomUUID();db.prepare('INSERT INTO expense_groups(id,name,kind,currency,owner_id,created_at) VALUES(?,?,?,?,?,?)').run(id,body.name.trim(),body.kind,row.budget.currency,userId,Date.now());
  db.prepare("INSERT INTO expense_group_members(id,group_id,user_id,name,email,budget_id,state,invited_by) VALUES(?,?,?,?,?,?,'active',?)").run(randomUUID(),id,userId,body.yourName.trim(),p.email.toLowerCase(),row.id,userId);
  for(const input of body.members)addMember(userId,id,input);
  return {group:groupDetail(userId,id)};
 });}
 function updateGroup(userId,id,body){return transact(userId,{...body,groupId:id,action:'group-update'},()=>{
  member(userId,id);const group=mutateGroup(id,body.expectedGroupRevision);
  if(group.owner_id!==userId)fail(403,'GROUP_OWNER','Only the group creator can change its members or name.');
  if(body.actionType==='add-member')addMember(userId,id,body.member);
  else if(body.actionType==='rename'){if(!clean(body.name,80))fail(400,'GROUP_NAME','Enter a group name.');db.prepare('UPDATE expense_groups SET name=? WHERE id=?').run(body.name.trim(),id);}
  else if(body.actionType==='archive'){if(groupBills.hasPending(id)||db.prepare("SELECT 1 FROM shared_changes WHERE group_id=? AND state='pending'").get(id))fail(409,'GROUP_REVIEW_PENDING','Complete or cancel the pending reviews before archiving.');if(groupDetail(userId,id).balances.some(b=>b.owed||b.owing||b.pending))fail(409,'GROUP_UNSETTLED','Settle the remaining balances before archiving.');db.prepare("UPDATE expense_groups SET state='archived' WHERE id=?").run(id);db.prepare("UPDATE group_bill_series SET state='complete',revision=revision+1 WHERE group_id=?").run(id);}
  else fail(400,'GROUP_ACTION','Choose a group action.');
  db.prepare('UPDATE expense_groups SET revision=revision+1 WHERE id=?').run(id);return {group:groupDetail(userId,id)};
 });}
 function inviteMember(userId,id,body){return transact(userId,{...body,memberId:id,action:'group-invite'},()=>{
  const target=db.prepare('SELECT * FROM expense_group_members WHERE id=?').get(id);if(!target)fail(404,'GROUP_NOT_FOUND','Invitation not found.');member(userId,target.group_id);
  if(target.state!=='invited'||getGroup(target.group_id).state!=='active')fail(409,'GROUP_INVITATION','This invitation is no longer available.');
  if(target.expires_at>Date.now()){const cached=db.prepare("SELECT response FROM shared_operations WHERE json_extract(response,'$.invitation.memberId')=? ORDER BY created_at DESC LIMIT 1").get(id);if(cached)return parse(cached.response);}
  const token=randomBytes(32).toString('hex'),expires=Date.now()+7*86400000;db.prepare('UPDATE expense_group_members SET token_hash=?,expires_at=? WHERE id=?').run(hash(token),expires,id);
  return {invitation:{memberId:id,groupId:target.group_id,url:origin+'/?group-invite#token='+token,name:target.name,groupName:getGroup(target.group_id).name,expiresAt:new Date(expires).toISOString()}};
 });}
 function invited(userId,body){
  const p=verified(userId);let target;
  if(body.token){if(typeof body.token!=='string'||!/^[0-9a-f]{64}$/.test(body.token))fail(404,'GROUP_INVITATION','Invitation not found.');target=db.prepare("SELECT * FROM expense_group_members WHERE token_hash=? AND expires_at>? AND state='invited'").get(hash(body.token),Date.now());}
  else target=db.prepare("SELECT * FROM expense_group_members WHERE id=? AND email=? AND state='invited'").get(body.memberId??'',p.email.toLowerCase());
  if(!target||(target.email&&target.email!==p.email.toLowerCase())||getGroup(target.group_id).state!=='active')fail(404,'GROUP_INVITATION','This invitation is unavailable. Use the invited email or request a new link.');
  if(members(target.group_id).some(m=>m.user_id===userId))fail(409,'GROUP_ALREADY_JOINED','You already belong to this group.');return target;
 }
 function previewInvitation(userId,body){const target=invited(userId,body),g=getGroup(target.group_id);return {name:g.name,kind:g.kind,currency:g.currency,memberCount:members(g.id).length,invitedName:target.name,disclosure:'Members can see the group’s bills, shares and repayment records. Your personal budget and account balances stay private.'};}
 function joinGroup(userId,body){return transact(userId,{...body,action:'group-join'},()=>{
  if(body.confirmJoin!==true)fail(400,'GROUP_CONFIRM','Review the group before joining.');const target=invited(userId,body),g=getGroup(target.group_id),p=profile(userId),row=ownedBudget(userId,body.budgetId,body.expectedRevision);
  if(row.budget.currency!==g.currency)fail(400,'GROUP_CURRENCY','Use a budget in '+g.currency+' for this group.');
  db.prepare("UPDATE expense_group_members SET user_id=?,email=?,budget_id=?,state='active',token_hash=NULL,expires_at=NULL WHERE id=?").run(userId,p.email.toLowerCase(),row.id,target.id);
  db.prepare("UPDATE expense_shares SET recipient_id=?,email=? WHERE group_member_id=? AND recipient_id IS NULL").run(userId,p.email.toLowerCase(),target.id);
  db.prepare('UPDATE expense_groups SET revision=revision+1 WHERE id=?').run(g.id);return {group:groupDetail(userId,g.id)};
 });}
 function preparePurchase(userId,body,row,participants){
  if(!body.groupId)return null;
  if(body.groupVersion!==1||body.ledgerVersion!==3)fail(426,'UPDATE_REQUIRED','Update SpentOn before adding group expenses.');
  const me=member(userId,body.groupId),group=getGroup(body.groupId);
  if(group.state!=='active'||!Number.isSafeInteger(body.expectedGroupRevision)||body.expectedGroupRevision>group.revision)fail(409,'GROUP_CHANGED','Review the current group before adding a bill.');
  if(db.prepare('SELECT count(*) n FROM shared_expenses WHERE group_id=?').get(group.id).n>=1000)fail(409,'GROUP_BILL_LIMIT','This group has reached 1,000 bills. Create a new group for future expenses.');
  if(me.budget_id!==row.id||row.budget.currency!==group.currency)fail(400,'GROUP_BUDGET','Open the budget you joined this group with.');
  const roster=members(group.id);
  for(let i=0;i<participants.length;i++){
   const input=body.shares[i];let target=roster.find(m=>m.id===input.memberId&&m.id!==me.id&&m.state!=='removed');
   if(!target&&!input.memberId){
    if(group.owner_id!==userId)fail(403,'GROUP_OWNER','Only the group creator can add a new person to this group.');
    const id=addMember(userId,group.id,input);target=members(group.id).find(m=>m.id===id);roster.push(target);
   }
   if(!target)fail(400,'GROUP_PARTICIPANT','Choose another member of this group.');
   const contact=context.people?.()?.resolve(userId,{personKey:target.invited_by===userId?target.person_key||target.id:target.id,name:target.name,email:target.email});
   Object.assign(participants[i],{email:target.email,name:target.name,personKey:contact?.person_key??target.id,groupMemberId:target.id,recipientId:target.user_id});
  }
  if(new Set(participants.map(p=>p.groupMemberId)).size!==participants.length)fail(400,'GROUP_PARTICIPANT','Add each member once.');return group;
 }
 function attachPurchase(group,id,participants){if(!group)return;db.prepare('UPDATE shared_expenses SET group_id=? WHERE id=?').run(group.id,id);for(const p of participants)db.prepare('UPDATE expense_shares SET group_member_id=?,recipient_id=? WHERE expense_id=? AND person_key=?').run(p.groupMemberId,p.recipientId??null,id,p.personKey);db.prepare('UPDATE expense_groups SET revision=revision+1 WHERE id=?').run(group.id);}
 function touchExpense(id){const e=expense(id);db.prepare('UPDATE shared_expenses SET revision=revision+1 WHERE id=?').run(id);db.prepare('UPDATE group_bill_plans SET revision=revision+1 WHERE id IN (SELECT bill_id FROM group_bill_parts WHERE expense_id=?)').run(id);if(e.group_id)db.prepare('UPDATE expense_groups SET revision=revision+1 WHERE id=?').run(e.group_id);}
 function pairBalances(userId,id){
  const me=member(userId,id),roster=members(id);return roster.filter(m=>m.id!==me.id).map(other=>{
   const incoming=db.prepare("SELECT s.* FROM expense_shares s JOIN shared_expenses e ON e.id=s.expense_id WHERE e.group_id=? AND e.owner_id=? AND s.group_member_id=? AND s.state!='cancelled'").all(id,userId,other.id);
   const outgoing=db.prepare("SELECT s.* FROM expense_shares s JOIN shared_expenses e ON e.id=s.expense_id WHERE e.group_id=? AND e.owner_id=? AND s.recipient_id=? AND s.state='accepted'").all(id,other.user_id??'',userId);
   const incomingTotal=incoming.reduce((n,s)=>n+Math.max(0,s.amount-s.refunded-offsetForShare(s.id)-settlements(s.id).filter(p=>p.state==='confirmed').reduce((v,p)=>v+p.amount,0)),0),outgoingTotal=outgoing.reduce((n,s)=>n+Math.max(0,s.amount-s.refunded-offsetForShare(s.id)-settlements(s.id).filter(p=>p.state==='confirmed').reduce((v,p)=>v+p.amount,0)),0);
   const offsettable=Math.min(incoming.filter(s=>s.state==='accepted').reduce((n,s)=>n+outstanding(s),0),outgoing.reduce((n,s)=>n+outstanding(s),0));
   return {memberId:other.id,name:other.name,owesYou:incomingTotal,youOwe:outgoingTotal,net:incomingTotal-outgoingTotal,offsettable,canOffset:other.state==='active'&&offsettable>0&&![...incoming,...outgoing].some(s=>pendingForShare(userId,s.id).reviewPending),lines:[...incoming.map(s=>({shareId:s.id,expenseId:s.expense_id,merchant:expense(s.expense_id).merchant,direction:'incoming',amount:outstanding(s)})),...outgoing.map(s=>({shareId:s.id,expenseId:s.expense_id,merchant:expense(s.expense_id).merchant,direction:'outgoing',amount:outstanding(s)}))]};
  });
 }
 // Group lifecycle changes use the same transaction and ownership checks.
 function allChanges(userId){verified(userId);return db.prepare('SELECT * FROM shared_changes c WHERE EXISTS(SELECT 1 FROM json_each(c.participants) WHERE value=?) ORDER BY created_at DESC LIMIT 100').all(userId).map(c=>lifecycle.view(userId,c,false));}
 function changesFor(userId,groupId){return db.prepare('SELECT * FROM shared_changes WHERE group_id=? ORDER BY created_at DESC LIMIT 100').all(groupId).filter(c=>parse(c.participants).includes(userId)).map(c=>lifecycle.view(userId,c,false));}
 const lifecycle=createLifecycle(db,{...context,getGroup,members,member,mutateGroup,offsetForShare,outstanding,assertUnlocked,touchExpense,expenseSummary,groupDetail});
 const groupBills=createGroupBills(db,{...context,getGroup,members,member,mutateGroup,expenseSummary,assertUnlocked,touchExpense});
 return {bills:groupBills,list:groupList,listChanges:allChanges,budgetIdFor:(userId,id)=>db.prepare("SELECT budget_id FROM expense_group_members WHERE group_id=? AND user_id=? AND state='active'").get(id,userId)?.budget_id??null,acceptBudget:(userId,e,row)=>{if(e.group_id&&member(userId,e.group_id).budget_id!==row.id)fail(400,'GROUP_BUDGET','Use the budget you joined this group with.');},get:groupDetail,create:createGroup,update:updateGroup,invite:inviteMember,previewInvitation,join:joinGroup,preparePurchase,attachPurchase,offsetForShare,pendingForShare,assertUnlocked,touchExpense,propose:lifecycle.propose,review:lifecycle.review,change:lifecycle.get};
}
function createLifecycle(db,c){
 const {fail,uuid,amount,hash,profile,verified,ownedBudget,expense,shares,settlements,saveBudget,transact,requireEditing,getGroup,members,member,mutateGroup,offsetForShare,outstanding,assertUnlocked,touchExpense}=c;
 const share=id=>{const value=db.prepare('SELECT * FROM expense_shares WHERE id=?').get(id??'');if(!value)fail(404,'SHARE_NOT_FOUND','Share not found.');return value;};
 const getRow=id=>{const row=db.prepare('SELECT * FROM shared_changes WHERE id=?').get(id??'');if(!row)fail(404,'CHANGE_NOT_FOUND','Change not found.');return row;};
 function access(userId,change){verified(userId);if(!parse(change.participants).includes(userId))fail(404,'CHANGE_NOT_FOUND','Change not found.');}
 function fingerprint(id){const s=share(id),e=expense(s.expense_id);return hash([s.id,s.amount,s.refunded,s.state,s.recipient_id,s.budget_id,e.total,e.refunded_total,e.purchase_date,e.currency,e.group_id,e.kind,settlements(id),offsetForShare(id)]);}
 function stillCurrent(payload){if(payload.targets.some(t=>fingerprint(t.id)!==t.fingerprint))fail(409,'CHANGE_STALE','A related bill changed. Cancel this proposal and review a new one.');}
 function build(change){
  const p=parse(change.payload),rows=new Map();
  const load=(owner,id)=>{
   if(rows.has(id))return rows.get(id);
   const current=db.prepare('SELECT revision FROM budgets WHERE id=? AND owner_id=?').get(id,owner);if(!current)fail(409,'CHANGE_BUDGET_MISSING','An affected budget is no longer available. Cancel this proposal.');
   const row=ownedBudget(owner,id,current.revision);row.before=row.budget;row.budget=structuredClone(row.budget);row.budget.version=3;rows.set(id,row);return row;
  };
  const base=(id,kind,value,date,expenseId,shareId,categoryId)=>({id,kind,amount:value,date,sharedExpenseId:expenseId,...(shareId?{sharedShareId:shareId}:{}),categoryId,payee:p.merchant??'Shared expense',note:change.reason,cleared:true});
  let commit=()=>{};
  if(change.kind==='offset'){
   for(const link of p.links){
    const a=share(link.first),b=share(link.second),ae=expense(a.expense_id),be=expense(b.expense_id);
    for(const [incoming,outgoing,ownBill,otherBill] of [[a,b,ae,be],[b,a,be,ae]]){
     const row=load(ownBill.owner_id,ownBill.budget_id);
     if(outgoing.budget_id!==row.id||outgoing.recipient_id!==row.owner_id)fail(409,'OFFSET_BUDGET','Both bills must belong to the same budget for each person.');
     const charge=row.budget.entries.find(e=>['shared_charge','shared_return'].includes(e.kind)&&e.sharedShareId===outgoing.id);
     if(!charge)fail(409,'OFFSET_CHARGE','Accept the original shares before offsetting.');
     if(row.budget.entries.some(e=>(e.sharedExpenseId===ownBill.id||e.sharedShareId===outgoing.id)&&e.date>p.date))fail(400,'OFFSET_DATE','Use a date on or after the related purchases and repayments.');
     row.budget.entries.push({...base(link.id+':'+row.owner_id,'shared_offset',link.amount,p.date,ownBill.id,outgoing.id,charge.categoryId),againstExpenseId:otherBill.id,sharedSettlementId:link.id,payee:profile(otherBill.owner_id).email});
    }
   }
   commit=()=>{for(const link of p.links)db.prepare("INSERT INTO share_offsets VALUES(?,?,?,?,?,'active')").run(link.id,change.id,link.first,link.second,link.amount);for(const id of new Set(p.targets.map(t=>share(t.id).expense_id)))touchExpense(id);};
  }else if(change.kind==='correct'){
   const e=expense(p.expenseId),row=load(e.owner_id,e.budget_id),original=row.budget.entries.find(x=>x.id===e.entry_id);
   const assigned=p.shares.reduce((n,s)=>n+s.amount,0);
   if(!original||row.budget.entries.some(x=>x.refundOf===original.id))fail(409,'CORRECTION_REFUNDS','This bill already has a refund. Record another refund or a separate additional expense.');
   if(original.splits&&!p.categoryId){
    if(p.total<original.splits.length)fail(400,'CORRECTION_CATEGORIES','The total is too small for the selected categories.');
    original.splits=proportionalAmounts(p.total,original.splits);
   }else if(p.categoryId){delete original.splits;}
   Object.assign(original,{amount:p.total,payee:p.merchant,date:p.date,categoryId:p.categoryId||original.categoryId,sharedAmount:assigned});
   for(const part of p.shares){const s=share(part.id);if(s.state==='accepted'&&(s.amount!==part.amount||e.merchant!==p.merchant||e.purchase_date!==p.date)){
    const recipient=load(s.recipient_id,s.budget_id),charge=recipient.budget.entries.find(x=>x.kind==='shared_charge'&&x.sharedShareId===s.id);
    if(!charge)fail(409,'CORRECTION_CHARGE','An accepted share could not be found.');Object.assign(charge,{amount:part.amount,payee:p.merchant,date:p.date});
   }}
   commit=()=>{db.prepare('UPDATE shared_expenses SET total=?,merchant=?,purchase_date=?,ledger_version=3 WHERE id=?').run(p.total,p.merchant,p.date,e.id);for(const part of p.shares){const prior=share(part.id),changed=prior.amount!==part.amount||e.merchant!==p.merchant||e.purchase_date!==p.date;db.prepare("UPDATE expense_shares SET amount=?,state=CASE WHEN state='declined' AND ? THEN 'invited' ELSE state END WHERE id=?").run(part.amount,changed?1:0,part.id);}touchExpense(e.id);};
  }else if(change.kind==='refund'){
   const e=expense(p.expenseId),row=load(e.owner_id,e.budget_id),original=row.budget.entries.find(x=>x.id===e.entry_id);
   if(!original)fail(409,'REFUND_PURCHASE','The original purchase is unavailable.');
   const refundEntry={...base(change.id+':refund','shared_refund',p.amount,p.date,e.id,null,original.categoryId),accountId:original.accountId,refundOf:original.id,sharedAmount:p.parts.reduce((n,s)=>n+s.amount,0),sharedReduction:p.parts.reduce((n,s)=>n+s.unpaid,0),payee:e.merchant};
   row.budget.entries.push(refundEntry);
   for(const part of p.parts){
    const s=share(part.id);
    if(s.state==='accepted'){
     const recipient=load(s.recipient_id,s.budget_id),charge=recipient.budget.entries.find(x=>x.kind==='shared_charge'&&x.sharedShareId===s.id);
     if(!charge)fail(409,'REFUND_CHARGE','The accepted share is unavailable.');
     recipient.budget.entries.push({...base(change.id+':credit:'+s.id,'shared_credit',part.amount,p.date,e.id,s.id,charge.categoryId),sharedReduction:part.unpaid,payee:e.merchant});
     if(part.extra){
      recipient.budget.entries.push({...base(part.claimEntry,'shared_claim',part.extra,p.date,part.claimExpense,part.claimShare,charge.categoryId),payee:'Refund from '+profile(e.owner_id).email});
      row.budget.entries.push({...base(change.id+':return:'+s.id,'shared_return',part.extra,p.date,part.claimExpense,part.claimShare,original.categoryId),payee:'Refund to '+profile(s.recipient_id).email});
     }
    }
   }
   for(const affected of rows.values())if(affected.before.entries.some(x=>(x.sharedExpenseId===e.id||x.againstExpenseId===e.id)&&x.date>p.date))fail(400,'REFUND_DATE','Use a refund date on or after the related purchases, offsets and repayments.');
   commit=()=>{
    db.prepare('UPDATE shared_expenses SET refunded_total=refunded_total+?,ledger_version=3 WHERE id=?').run(p.amount,e.id);
    for(const part of p.parts){const s=share(part.id);db.prepare("UPDATE expense_shares SET refunded=refunded+?,state=CASE WHEN state!='accepted' AND amount=refunded+? THEN 'refunded' ELSE state END WHERE id=?").run(part.amount,part.amount,s.id);
     if(part.extra){
      db.prepare("INSERT INTO shared_expenses(id,owner_id,budget_id,entry_id,currency,total,merchant,purchase_date,created_at,ledger_version,group_id,kind,source_expense_id) VALUES(?,?,?,?,?,?,?,?,?,3,?,'refund',?)").run(part.claimExpense,s.recipient_id,s.budget_id,part.claimEntry,e.currency,part.extra,'Refund · '+e.merchant,p.date,Date.now(),e.group_id,e.id);
      const payerMember=e.group_id?members(e.group_id).find(m=>m.user_id===e.owner_id):null;
      db.prepare("INSERT INTO expense_shares(id,expense_id,email,amount,state,recipient_id,budget_id,name,person_key,group_member_id) VALUES(?,?,?,?,'accepted',?,?,?,?,?)").run(part.claimShare,part.claimExpense,profile(e.owner_id).email,part.extra,e.owner_id,e.budget_id,payerMember?.name??profile(e.owner_id).email,payerMember?.id??profile(e.owner_id).email,payerMember?.id??null);
     }
    }
    touchExpense(e.id);
   };
  }else if(change.kind==='reverse_payment'){
   const payment=db.prepare('SELECT * FROM share_settlements WHERE id=?').get(p.settlementId),s=share(payment.share_id),e=expense(s.expense_id);
   for(const [owner,budgetId,entryId] of [[s.recipient_id,s.budget_id,payment.payment_entry],[e.owner_id,e.budget_id,payment.received_entry]]){
    if(!entryId)continue;const row=load(owner,budgetId),original=row.budget.entries.find(x=>x.id===entryId);
    if(!original)fail(409,'REVERSAL_MISSING','The original repayment record is unavailable.');
    row.budget.entries.push({...base(change.id+':void:'+owner,'shared_void',original.amount,original.date,original.sharedExpenseId,original.sharedShareId,original.categoryId??row.budget.entries.find(x=>x.id===e.entry_id)?.categoryId),reversalOf:original.id,payee:original.payee});
   }
   commit=()=>{db.prepare("UPDATE share_settlements SET state='reversed' WHERE id=?").run(payment.id);touchExpense(e.id);};
  }else if(change.kind==='reverse_offset'){
   const previous=getRow(p.originalChange),old=parse(previous.payload);
   for(const link of old.links){
    for(const s of [share(link.first),share(link.second)]){const e=expense(s.expense_id),row=load(e.owner_id,e.budget_id),original=row.budget.entries.find(x=>x.id===link.id+':'+e.owner_id);if(!original)fail(409,'REVERSAL_MISSING','The original offset is unavailable.');row.budget.entries.push({...base(change.id+':void:'+link.id+':'+e.owner_id,'shared_void',original.amount,original.date,original.sharedExpenseId,original.sharedShareId,original.categoryId),reversalOf:original.id});}
   }
   commit=()=>{db.prepare("UPDATE share_offsets SET state='reversed' WHERE change_id=?").run(previous.id);for(const id of new Set(p.targets.map(t=>share(t.id).expense_id)))touchExpense(id);};
  }else fail(400,'CHANGE_KIND','Choose a supported shared change.');
  for(const row of rows.values())try{row.budget=validateBudget(row.budget);}catch(error){fail(400,'CHANGE_BUDGET',error.message);}
  return {rows,commit};
 }
 function view(userId,change,includePreview=true){
  access(userId,change);const p=parse(change.payload),people=parse(change.participants),approved=parse(change.approvals),visibleApprovals={...approved};let preview=null,problem=null,canApprove=false;
  if(change.state==='pending'&&includePreview)try{
   stillCurrent(p);const plan=build(change);for(const row of plan.rows.values())if(visibleApprovals[row.owner_id]!==row.revision)delete visibleApprovals[row.owner_id];const own=[...plan.rows.values()].find(row=>row.owner_id===userId);
   if(own){const before=calculate(own.before,today().slice(0,7)),after=calculate(own.budget,today().slice(0,7));preview={budgetId:own.id,budgetName:own.before.name,revision:own.revision,currency:own.budget.currency,categories:own.budget.categories.flatMap(c=>{const a=before.categories[c.id],b=after.categories[c.id];return a.available!==b.available||a.spent!==b.spent?[{id:c.id,name:c.name,beforeLeft:a.available,afterLeft:b.available,beforeSpent:a.spent,afterSpent:b.spent}]:[];}),before:{cash:before.cash,ready:before.ready,spent:before.spent,receivable:before.shared.receivable,owed:before.shared.owed,reserved:before.shared.reserved},after:{cash:after.cash,ready:after.ready,spent:after.spent,receivable:after.shared.receivable,owed:after.shared.owed,reserved:after.shared.reserved}};canApprove=approved[userId]!==own.revision;}
  }catch(error){problem=error.message;}
  const billOwner=p.expenseId?db.prepare('SELECT owner_id FROM shared_expenses WHERE id=?').get(p.expenseId)?.owner_id:change.initiator_id;
  const visiblePart=part=>change.group_id||userId===billOwner||db.prepare('SELECT recipient_id FROM expense_shares WHERE id=?').get(part.id)?.recipient_id===userId;
  const safeName=part=>db.prepare('SELECT name,email FROM expense_shares WHERE id=?').get(part.id);
  const billName=shareId=>db.prepare('SELECT e.merchant FROM expense_shares s JOIN shared_expenses e ON e.id=s.expense_id WHERE s.id=?').get(shareId)?.merchant??'Historical bill';
  const label=id=>{if(!change.group_id&&userId!==billOwner&&id!==userId&&id!==billOwner)return 'Another participant';const m=change.group_id?members(change.group_id).find(m=>m.user_id===id):null;return m?.name??db.prepare('SELECT email FROM users WHERE id=?').get(id)?.email??'Former member';};
  return {id:change.id,groupId:change.group_id,currency:p.currency??(change.group_id?getGroup(change.group_id).currency:p.expenseId?db.prepare('SELECT currency FROM shared_expenses WHERE id=?').get(p.expenseId)?.currency:null),kind:change.kind,state:change.state,reason:change.reason,createdAt:new Date(change.created_at).toISOString(),merchant:p.merchant??(p.expenseId?db.prepare('SELECT merchant FROM shared_expenses WHERE id=?').get(p.expenseId)?.merchant:undefined),amount:p.amount??p.total,date:p.date,
   participants:people.map(id=>({name:label(id),isYou:id===userId,approved:visibleApprovals[id]!==undefined})),canApprove,canCancel:change.state==='pending',preview,problem,
   before:p.before?{...p.before,shares:p.before.shares?.filter(visiblePart).map(({id,...part})=>part)}:undefined,after:change.kind==='correct'&&p.total!==undefined?{total:p.total,merchant:p.merchant,date:p.date,shares:p.shares.filter(visiblePart).map(s=>({amount:s.amount,name:safeName(s)?.name||safeName(s)?.email||'Former member'}))}:undefined,
   refunds:change.kind==='refund'?p.parts?.filter(visiblePart).map(part=>({name:safeName(part)?.name||safeName(part)?.email||'Former member',amount:part.amount,unpaid:part.unpaid,extra:part.extra})):undefined,
   counterparty:['offset','reverse_offset'].includes(change.kind)?label(people.find(id=>id!==userId)??userId):undefined,
   lines:change.kind==='offset'?p.links.map(link=>{const first= billName(link.first),second=billName(link.second),owner=db.prepare('SELECT e.owner_id FROM expense_shares s JOIN shared_expenses e ON e.id=s.expense_id WHERE s.id=?').get(link.first)?.owner_id;return {amount:link.amount,first,second,incomingBill:owner?(owner===userId?first:second):undefined,outgoingBill:owner?(owner===userId?second:first):undefined};}):undefined,
   canReverse:change.kind==='offset'&&change.state==='applied'&&!(p.targets??[]).some(t=>db.prepare('SELECT refunded FROM expense_shares WHERE id=?').get(t.id)?.refunded>0)&&!!db.prepare("SELECT 1 FROM share_offsets WHERE change_id=? AND state='active'").get(change.id)};
 }
 function prepare(userId,body){
  let p={},targets=[],groupId=null;
  if(!clean(body.reason,300))fail(400,'CHANGE_REASON','Give a short reason for this change.');
  if(body.kind==='offset'){
   groupId=body.groupId;const me=member(userId,groupId);mutateGroup(groupId,body.expectedGroupRevision);
   const other=members(groupId).find(m=>m.id===body.otherMemberId&&m.state==='active'&&m.user_id!==userId);if(!other)fail(400,'OFFSET_PERSON','Choose another joined member of this group.');
   const side=(owner,recipient)=>db.prepare("SELECT s.* FROM expense_shares s JOIN shared_expenses e ON e.id=s.expense_id WHERE e.group_id=? AND e.owner_id=? AND s.recipient_id=? AND s.state='accepted' ORDER BY e.purchase_date,e.created_at,s.id").all(groupId,owner,recipient).map(s=>({...s,available:outstanding(s)})).filter(s=>s.available>0);
   const first=side(userId,other.user_id),second=side(other.user_id,userId),maximum=Math.min(first.reduce((n,s)=>n+s.available,0),second.reduce((n,s)=>n+s.available,0));
   const value=body.amount??maximum;if(!amount(value)||value>maximum||!validDate(body.date))fail(400,'OFFSET_AMOUNT','Choose a positive amount within both unpaid balances and a valid date.');
   const links=[];let remaining=value,i=0,j=0;
   while(remaining){const matched=Math.min(remaining,first[i].available,second[j].available);links.push({id:randomUUID(),first:first[i].id,second:second[j].id,amount:matched});targets.push(first[i].id,second[j].id);first[i].available-=matched;second[j].available-=matched;remaining-=matched;if(!first[i].available)i++;if(!second[j].available)j++;}
   p={amount:value,date:body.date,links,merchant:'Offset with '+other.name};
  }else if(['correct','refund'].includes(body.kind)){
   const e=expense(body.expenseId);if(e.owner_id!==userId)fail(404,'SHARE_NOT_FOUND','Only the person who recorded this bill can propose a change.');
   if(db.prepare('SELECT 1 FROM group_ledger_archive WHERE id=?').get(e.id))fail(409,'HISTORICAL_GROUP_BILL','This bill includes a removed account. Its history is retained; record a separate agreed adjustment instead.');
   if(e.ledger_version<2||e.kind!=='purchase')fail(409,'CHANGE_LEGACY','This action needs an original purchase with current shared-budget accounting.');
   if(body.expectedExpenseRevision!==e.revision)fail(409,'CHANGE_STALE','This bill changed. Reload it before proposing a change.');
   groupId=e.group_id;const list=shares(e.id).filter(s=>!['cancelled','refunded'].includes(s.state));targets=list.map(s=>s.id);
   if(list.some(s=>settlements(s.id).some(p=>p.state!=='confirmed')))fail(409,'CHANGE_PENDING_PAYMENT','Confirm or reverse pending repayments before changing this bill.');
   if(body.kind==='correct'){
    if(e.refunded_total)fail(409,'CORRECTION_REFUNDS','This bill has a refund. Record an additional expense or another refund instead.');
    if(!amount(body.total)||!clean(body.merchant,160)||!validDate(body.date)||!Array.isArray(body.shares)||body.shares.length!==list.length)fail(400,'CORRECTION_DETAILS','Review the purchase total, merchant, date and every person’s share.');
    const parts=body.shares.map(part=>({id:part.id,amount:part.amount}));
    if(new Set(parts.map(s=>s.id)).size!==list.length||parts.some(part=>!list.some(s=>s.id===part.id)||!amount(part.amount)||part.amount<settlements(part.id).reduce((n,p)=>n+p.amount,0)+offsetForShare(part.id))||parts.reduce((n,s)=>n+s.amount,0)>body.total)fail(400,'CORRECTION_SHARES','Shares must fit the purchase and cover recorded repayments and offsets. Reverse a mistaken repayment or offset first.');
    p={expenseId:e.id,total:body.total,merchant:body.merchant.trim(),date:body.date,categoryId:body.categoryId,shares:parts,before:{total:e.total,merchant:e.merchant,date:e.purchase_date,shares:list.map(s=>({id:s.id,name:s.name||s.email,amount:s.amount}))}};
   }else{
    if(!amount(body.amount)||body.amount>e.total-e.refunded_total||!validDate(body.date))fail(400,'REFUND_AMOUNT','Enter a refund within the unrefunded purchase total and a valid date.');
    const remaining=e.total-e.refunded_total,weights=list.map(s=>s.amount-s.refunded),personal=remaining-weights.reduce((n,a)=>n+a,0);
    if(personal<0)fail(409,'REFUND_BALANCE','Review the bill’s existing shares first.');
    const allocations=proportional(body.amount,[personal,...weights]);
    const parts=list.map((s,index)=>{const value=allocations[index+1],unpaid=Math.min(value,outstanding(s));return {id:s.id,amount:value,unpaid,extra:value-unpaid,claimExpense:randomUUID(),claimShare:randomUUID(),claimEntry:randomUUID()};}).filter(p=>p.amount>0);
    if(parts.some(part=>part.extra&&share(part.id).state!=='accepted'))fail(409,'REFUND_JOIN_REQUIRED','A person with money to receive back must join and accept their share before this refund can be recorded.');
    p={expenseId:e.id,amount:body.amount,date:body.date,parts,merchant:e.merchant};
   }
  }else if(body.kind==='reverse_payment'){
   const payment=db.prepare('SELECT * FROM share_settlements WHERE id=?').get(body.settlementId??'');if(!payment)fail(404,'PAYMENT_NOT_FOUND','Repayment not found.');const s=share(payment.share_id),e=expense(s.expense_id);
   if(userId!==e.owner_id&&userId!==s.recipient_id)fail(404,'PAYMENT_NOT_FOUND','Repayment not found.');
   if(e.ledger_version<2||payment.state==='reversed')fail(409,'PAYMENT_REVERSED','This repayment cannot be reversed.');
   if(e.refunded_total)fail(409,'REVERSAL_REFUND','This payment is part of a refunded bill. Review the refund and its return payment instead.');
   groupId=e.group_id;targets=[s.id];p={settlementId:payment.id,expenseId:e.id,amount:payment.amount,merchant:e.merchant};
  }else if(body.kind==='reverse_offset'){
   const original=getRow(body.changeId);access(userId,original);if(original.kind!=='offset'||original.state!=='applied'||!db.prepare("SELECT 1 FROM share_offsets WHERE change_id=? AND state='active'").get(original.id))fail(409,'OFFSET_REVERSED','This offset is no longer active.');
   const old=parse(original.payload);if(old.targets.some(t=>share(t.id).refunded>0))fail(409,'OFFSET_HAS_REFUND','This offset is part of a refunded bill and cannot be reversed independently.');groupId=original.group_id;targets=old.targets.map(t=>t.id);p={originalChange:original.id,amount:old.amount,merchant:old.merchant};
  }else fail(400,'CHANGE_KIND','Choose a correction, refund, reversal or direct offset.');
  if(groupId){member(userId,groupId);if(getGroup(groupId).state!=='active')fail(409,'GROUP_ARCHIVED','This group is archived.');}
  p.currency=groupId?getGroup(groupId).currency:p.expenseId?expense(p.expenseId).currency:parse(getRow(p.originalChange).payload).currency;
  targets=[...new Set(targets)];assertUnlocked(targets);p.targets=targets.map(id=>({id,fingerprint:fingerprint(id)}));return {payload:p,groupId,targets};
 }
 function propose(userId,body){return transact(userId,{...body,action:'shared-change-propose'},()=>{
  if(body.groupVersion!==1||body.confirmReview!==true)fail(400,'CHANGE_REVIEW','Review the change before requesting approval.');
  if(db.prepare("SELECT count(*) n FROM shared_changes WHERE initiator_id=? AND state='pending'").get(userId).n>=20)fail(409,'CHANGE_LIMIT','Complete or cancel existing reviews before requesting another change.');
  const prepared=prepare(userId,body),now=Date.now(),change={id:randomUUID(),group_id:prepared.groupId,kind:body.kind,initiator_id:userId,state:'pending',reason:body.reason.trim(),payload:JSON.stringify(prepared.payload),participants:'[]',approvals:'{}',created_at:now,updated_at:now};
  const plan=build(change),people=[...new Set([...plan.rows.values()].map(row=>row.owner_id))],own=[...plan.rows.values()].find(row=>row.owner_id===userId);
  if(!own||own.revision!==body.expectedRevision)fail(409,'REVISION_CONFLICT','Your budget changed. Reload it and review the proposal again.');
  change.participants=JSON.stringify(people); // A proposal is a review request; it does not approve another budget.
  db.prepare('INSERT INTO shared_changes VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(change.id,change.group_id,change.kind,userId,change.state,change.reason,change.payload,change.participants,change.approvals,now,now);
  for(const id of prepared.targets)db.prepare('INSERT INTO shared_change_targets VALUES(?,?)').run(change.id,id);
  return {change:view(userId,change)};
 });}
 function review(userId,id,body){return transact(userId,{...body,changeId:id,action:'shared-change-review'},()=>{
  const change=getRow(id);access(userId,change);if(change.state!=='pending')fail(409,'CHANGE_CLOSED','This review has already finished.');
  if(body.decision==='decline'){db.prepare("UPDATE shared_changes SET state='cancelled',updated_at=? WHERE id=?").run(Date.now(),id);return {change:view(userId,getRow(id))};}
  if(body.decision!=='approve'||body.confirmReview!==true)fail(400,'CHANGE_CONFIRM','Confirm your reviewed budget changes first.');
  const payload=parse(change.payload);stillCurrent(payload);const plan=build(change),own=[...plan.rows.values()].find(row=>row.owner_id===userId);
  if(!own||own.revision!==body.expectedRevision)fail(409,'REVISION_CONFLICT','Your budget changed. Review its current amounts before approving.');
  const approved=parse(change.approvals);approved[userId]=own.revision;
  for(const row of plan.rows.values())if(approved[row.owner_id]!==undefined&&approved[row.owner_id]!==row.revision)delete approved[row.owner_id];
  db.prepare('UPDATE shared_changes SET approvals=?,updated_at=? WHERE id=?').run(JSON.stringify(approved),Date.now(),id);
  let snapshot;
  if(parse(change.participants).every(owner=>approved[owner]!==undefined)){
   for(const row of plan.rows.values())requireEditing(row.owner_id);
   plan.commit();for(const row of plan.rows.values()){const saved=saveBudget({...row,budget:row.before},row.budget);if(row.owner_id===userId)snapshot=saved;}
   db.prepare("UPDATE shared_changes SET state='applied',updated_at=? WHERE id=?").run(Date.now(),id);
  }
  return {change:view(userId,getRow(id)),...(snapshot?{snapshot}:{})};
 });}
 return {view,propose,review,get:(userId,id)=>{const row=getRow(id);access(userId,row);return view(userId,row);}};
}

function proportional(total,weights){
 const sum=weights.reduce((n,w)=>n+BigInt(w),0n),parts=weights.map((w,index)=>{const numerator=BigInt(total)*BigInt(w);return {index,amount:Number(numerator/sum),remainder:numerator%sum};});
 let remaining=total-parts.reduce((n,p)=>n+p.amount,0);
 for(const part of [...parts].sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1)){if(!remaining)break;part.amount++;remaining--;}
 return parts.map(p=>p.amount);
}

/** Shared group metadata only. Other members' budget documents and account IDs are never exported. */
export function exportGroupData(db,userId,email=''){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='expense_groups'").get())return {groups:[],sharedChanges:[]};
 const groups=db.prepare('SELECT g.id,g.name,g.kind,g.currency,g.state,g.revision FROM expense_groups g JOIN expense_group_members m ON m.group_id=g.id WHERE m.user_id=? OR (m.state=\'invited\' AND m.email=?)').all(userId,email);
 const planned=g=>db.prepare("SELECT 1 FROM sqlite_master WHERE name='group_bill_plans'").get()?{
  combinedBills:db.prepare('SELECT id,state,merchant,purchase_date,plan,series_id,occurrence_date FROM group_bill_plans WHERE group_id=?').all(g.id).map(({plan,...row})=>{const p=parse(plan);return {...row,total:p.total,method:p.method,people:p.people,payers:p.payers.map(({memberId,amount})=>({memberId,amount}))};}),
  scheduledBills:db.prepare('SELECT id,state,merchant,definition,schedule,next_index FROM group_bill_series WHERE group_id=?').all(g.id).map(({definition,schedule,...row})=>({...row,definition:parse(definition),schedule:parse(schedule)}))
 }:{};
 return {groups:groups.map(g=>({...g,...planned(g),members:db.prepare('SELECT id,name,state,CASE WHEN user_id=? THEN budget_id ELSE NULL END budget_id FROM expense_group_members WHERE group_id=?').all(userId,g.id),bills:db.prepare('SELECT id,kind,total,refunded_total,merchant,purchase_date FROM shared_expenses WHERE group_id=?').all(g.id),retainedHistory:db.prepare('SELECT document FROM group_ledger_archive WHERE group_id=?').all(g.id).map(row=>parse(row.document))})),
  sharedChanges:db.prepare('SELECT id,group_id,kind,state,reason,payload,created_at,updated_at FROM shared_changes c WHERE EXISTS(SELECT 1 FROM json_each(c.participants) WHERE value=?)').all(userId).map(({payload,...row})=>{const p=parse(payload);return {...row,amount:p.amount??p.total,date:p.date,expenseId:p.expenseId,originalChange:p.originalChange,settlementId:p.settlementId,offsets:p.links?.map(l=>({firstShare:l.first,secondShare:l.second,amount:l.amount}))};})};
}

/** Run inside the account erasure transaction, before deleting its private shares. */
export function eraseGroupData(db,userId,email=''){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='expense_groups'").get())return;
 const mine=db.prepare('SELECT * FROM expense_group_members WHERE user_id=? OR (user_id IS NULL AND email=?)').all(userId,email),groupIds=[...new Set(mine.map(m=>m.group_id))];
 for(const groupId of groupIds){
  const roster=db.prepare('SELECT * FROM expense_group_members WHERE group_id=?').all(groupId),erasedIds=new Set(mine.filter(m=>m.group_id===groupId).map(m=>m.id));
  erasePlannedBills(db,userId,groupId,[...erasedIds]);
  const bills=db.prepare('SELECT DISTINCT e.* FROM shared_expenses e LEFT JOIN expense_shares s ON s.expense_id=e.id WHERE e.group_id=? AND (e.owner_id=? OR s.recipient_id=? OR s.email=?)').all(groupId,userId,userId,email);
  for(const e of bills){
   const previous=parse(db.prepare('SELECT document FROM group_ledger_archive WHERE id=?').get(e.id)?.document),all=db.prepare('SELECT * FROM expense_shares WHERE expense_id=?').all(e.id);
   const retained=all.filter(s=>e.owner_id===userId||erasedIds.has(s.group_member_id)).map(s=>{
    const amounts=db.prepare("SELECT COALESCE(sum(CASE WHEN state='confirmed' THEN amount ELSE 0 END),0) confirmed,COALESCE(sum(CASE WHEN state IN ('pending','disputed') THEN amount ELSE 0 END),0) pending FROM share_settlements WHERE share_id=?").get(s.id);
    const offset=db.prepare("SELECT COALESCE(sum(amount),0) n FROM share_offsets WHERE state='active' AND (first_share=? OR second_share=?)").get(s.id,s.id).n;
    return {id:s.id,memberId:s.group_member_id,amount:s.amount,refunded:s.refunded,...amounts,offset,state:s.state};
   });
   const ids=new Set(retained.map(s=>s.id));retained.push(...(previous?.shares??[]).filter(s=>!ids.has(s.id)));
   const archived={id:e.id,kind:e.kind,merchant:e.owner_id===userId?'Expense from a former member':e.merchant,date:e.purchase_date,total:e.total,refunded:e.refunded_total,payerId:roster.find(m=>m.user_id===e.owner_id)?.id??previous?.payerId,revision:e.revision,hasReceipt:false,archived:true,shares:retained};
   db.prepare('INSERT INTO group_ledger_archive VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document').run(e.id,groupId,JSON.stringify(archived));
  }
  const affectedCache="json_extract(response,'$.group.id')=? OR json_extract(response,'$.expense.groupId')=? OR json_extract(response,'$.change.groupId')=? OR json_extract(response,'$.invitation.groupId')=? OR json_extract(response,'$.bill.groupId')=? OR json_extract(response,'$.series.groupId')=?";
  db.prepare('INSERT OR IGNORE INTO shared_operation_tombstones SELECT user_id,operation_id,request_hash,? FROM shared_operations WHERE '+affectedCache).run(Date.now(),groupId,groupId,groupId,groupId,groupId,groupId);
  db.prepare('DELETE FROM shared_operations WHERE '+affectedCache).run(groupId,groupId,groupId,groupId,groupId,groupId);
  db.prepare("UPDATE expense_group_members SET user_id=NULL,email=NULL,budget_id=NULL,name='Former member',state='removed',token_hash=NULL,expires_at=NULL WHERE group_id=? AND (user_id=? OR (user_id IS NULL AND email=?))").run(groupId,userId,email);
  const replacement=db.prepare("SELECT user_id FROM expense_group_members WHERE group_id=? AND state='active' AND user_id IS NOT NULL ORDER BY rowid LIMIT 1").get(groupId)?.user_id;
  db.prepare('UPDATE expense_groups SET owner_id=?,state=CASE WHEN ? IS NULL THEN \'archived\' ELSE state END,revision=revision+1 WHERE id=? AND owner_id=?').run(replacement??null,replacement??null,groupId,userId);
 }
 const changes=db.prepare('SELECT * FROM shared_changes c WHERE EXISTS(SELECT 1 FROM json_each(c.participants) WHERE value=?)').all(userId);
 for(const change of changes){const p=parse(change.payload),safe={currency:p.currency,amount:p.amount??p.total,date:p.date,expenseId:p.expenseId,merchant:'Historical shared change',targets:[],links:p.links,shares:[],originalChange:p.originalChange,settlementId:p.settlementId};
  db.prepare("UPDATE shared_changes SET state=CASE WHEN state='pending' THEN 'cancelled' ELSE state END,initiator_id=CASE WHEN initiator_id=? THEN NULL ELSE initiator_id END,reason='Record retained after an account was removed.',payload=?,participants=?,approvals='{}' WHERE id=?").run(userId,JSON.stringify(safe),JSON.stringify(parse(change.participants).filter(id=>id!==userId)),change.id);
  db.prepare("INSERT OR IGNORE INTO shared_operation_tombstones SELECT user_id,operation_id,request_hash,? FROM shared_operations WHERE json_extract(response,'$.change.id')=?").run(Date.now(),change.id);
  db.prepare("DELETE FROM shared_operations WHERE json_extract(response,'$.change.id')=?").run(change.id);
 }
}
