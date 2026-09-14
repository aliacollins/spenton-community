import {exportGroupData,eraseGroupData} from './shared-groups.mjs';
import { appendFileSync, closeSync, existsSync, fsyncSync, openSync, readFileSync } from 'node:fs';

/** Only explicitly selected personal fields are exported; authentication secrets never leave the server. */
export function exportAccountData(db,userId,{includeCloud=true}={}){
 const profile=db.prepare('SELECT id,name,email,emailVerified,createdAt,updatedAt FROM auth_users WHERE id=?').get(userId);
 return {...exportGroupData(db,userId,profile?.emailVerified?profile.email.toLowerCase():''),format:'spenton-account-export',version:1,exportedAt:new Date().toISOString(),profile,
  people:db.prepare("SELECT 1 FROM sqlite_master WHERE name='private_people'").get()?db.prepare('SELECT person_key,name,email,created_at FROM private_people WHERE user_id=? ORDER BY created_at').all(userId):[],
  plannedShares:db.prepare("SELECT 1 FROM sqlite_master WHERE name='planned_share_plans'").get()?db.prepare('SELECT budget_id,schedule_id,plan FROM planned_share_plans WHERE user_id=?').all(userId).map(row=>({...row,plan:JSON.parse(row.plan)})):[],
  notificationDevices:db.prepare("SELECT 1 FROM sqlite_master WHERE name='notification_devices'").get()?db.prepare('SELECT environment,updated_at FROM notification_devices WHERE user_id=? ORDER BY updated_at').all(userId):[],
  receiptScans:db.prepare("SELECT 1 FROM sqlite_master WHERE name='receipt_scans'").get()?db.prepare('SELECT id,budget_id,created_at,state,input_tokens,output_tokens,reasoning_tokens,cost_nano,error_code,CASE WHEN created_at>=? THEN result ELSE NULL END result FROM receipt_scans WHERE user_id=? ORDER BY created_at').all(Date.now()-86400000,userId).map(row=>({...row,result:row.result?JSON.parse(row.result):null})):[],
  sharedExpenses:db.prepare("SELECT 1 FROM sqlite_master WHERE name='expense_shares'").get()?db.prepare('SELECT s.id,s.email,s.name,s.person_key,s.amount,s.state,e.ledger_version,e.currency,e.total,e.merchant,e.purchase_date FROM expense_shares s JOIN shared_expenses e ON e.id=s.expense_id WHERE e.owner_id=? OR s.recipient_id=? OR (s.recipient_id IS NULL AND s.email=?)').all(userId,userId,profile?.emailVerified?profile.email.toLowerCase():'').map(row=>({...row,settlements:db.prepare('SELECT id,amount,state,paid_date,payer_recorded FROM share_settlements WHERE share_id=? ORDER BY created_at').all(row.id)})):[],
  sharedBills:db.prepare("SELECT 1 FROM sqlite_master WHERE name='shared_receipts'").get()?db.prepare("SELECT r.expense_id,r.document FROM shared_receipts r JOIN shared_expenses e ON e.id=r.expense_id WHERE e.owner_id=? OR EXISTS(SELECT 1 FROM expense_shares s WHERE s.expense_id=e.id AND s.state IN ('invited','accepted') AND (s.recipient_id=? OR (s.recipient_id IS NULL AND s.email=?)))").all(userId,userId,profile?.emailVerified?profile.email.toLowerCase():'').map(row=>({expenseId:row.expense_id,bill:JSON.parse(row.document)})):[],
  budgets:db.prepare('SELECT id,revision,updated_at,document FROM budgets WHERE owner_id=? ORDER BY id').all(userId).map(row=>({id:row.id,revision:row.revision,updatedAt:new Date(row.updated_at).toISOString(),budget:JSON.parse(row.document)})),
  budgetResets:db.prepare("SELECT 1 FROM sqlite_master WHERE name='account_reset_requests'").get()?db.prepare('SELECT id,reason,budget_count,state,created_at,expires_at,completed_at FROM account_reset_requests WHERE user_id=? ORDER BY created_at').all(userId):[],
  ownerTests:db.prepare("SELECT 1 FROM sqlite_master WHERE name='owner_test_budgets'").get()?db.prepare('SELECT id,revision,updated_at,document,feedback FROM owner_test_budgets WHERE owner_id=? AND deleted_at IS NULL ORDER BY id').all(userId).map(row=>({id:row.id,revision:row.revision,updatedAt:new Date(row.updated_at).toISOString(),budget:JSON.parse(row.document),feedback:row.feedback?JSON.parse(row.feedback):null})):[],
  emailPreferences:db.prepare('SELECT mode,timezone,hour,consented_at,updated_at FROM email_preferences WHERE user_id=?').get(userId)??{mode:'off'},
  emailActivity:db.prepare('SELECT joined_at,last_spend_at FROM email_activity WHERE user_id=?').get(userId)??null,
  onboarding:db.prepare('SELECT version,status,experience,budget_id,milestones,skipped,analytics_consent,consented_at,created_at,started_at,updated_at,completed_at FROM onboarding_progress WHERE user_id=?').get(userId)??null,
  onboardingInteractions:db.prepare('SELECT step,kind,reason,created_at FROM onboarding_events WHERE user_id=? ORDER BY created_at').all(userId),
  lastSignIn:db.prepare('SELECT method,updated_at FROM auth_signin_preferences WHERE user_id=?').get(userId)??null,
  signInMethods:db.prepare('SELECT providerId,createdAt FROM auth_accounts WHERE userId=?').all(userId),
  sessions:db.prepare('SELECT createdAt,expiresAt FROM auth_sessions WHERE userId=?').all(userId),
  ...(includeCloud?{entitlements:db.prepare('SELECT budget_credits,access_expires_at,updated_at FROM user_entitlements WHERE user_id=?').get(userId)??null,
  couponRedemptions:db.prepare('SELECT budget_credits,access_days,created_at FROM coupon_redemptions WHERE user_id=?').all(userId),
  couponDiscounts:db.prepare('SELECT c.label,c.discount_kind,c.discount_value,c.eligible_offer,d.state,d.checkout_id FROM coupon_discounts d JOIN coupons c ON c.id=d.coupon_id WHERE d.user_id=?').all(userId),
  freeGrants:db.prepare('SELECT operation_id,result,created_at FROM admin_access_grants WHERE user_id=?').all(userId).map(row=>({...row,result:JSON.parse(row.result)})),
  payments:db.prepare('SELECT payment_id,amount_minor,currency,starts_at,ends_at,refunded_minor,verified_at FROM billing_payments WHERE user_id=?').all(userId),
  subscriptionInvoices:db.prepare("SELECT 1 FROM sqlite_master WHERE name='billing_invoice_periods'").get()?db.prepare('SELECT i.invoice_id,i.payment_id,i.starts_at,i.ends_at,i.cycle,i.discounted FROM billing_invoice_periods i JOIN billing_payments p ON p.payment_id=i.payment_id WHERE p.user_id=? ORDER BY i.starts_at').all(userId):[],
  checkouts:db.prepare('SELECT id,offer,amount_minor,currency,state,provider_status,cancel_requested,created_at FROM billing_checkouts WHERE user_id=?').all(userId),
  securityEvents:db.prepare('SELECT action,created_at FROM admin_audit WHERE actor_id=? OR subject_id=? ORDER BY created_at').all(userId,userId)}:{})};
}

export function createErasureService(db,dbPath){
 const ledger=dbPath===':memory:'?null:dbPath+'.erasures.jsonl';
 db.exec('CREATE TABLE IF NOT EXISTS account_erasures (user_id TEXT PRIMARY KEY,deleted_at INTEGER NOT NULL) STRICT; PRAGMA secure_delete=ON;');
 function purge(userId,deletedAt){
  db.exec('BEGIN IMMEDIATE');
  try{
   const profile=db.prepare('SELECT email FROM users WHERE id=?').get(userId);
   if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='private_people'").get())db.prepare('DELETE FROM private_people WHERE user_id=?').run(userId);
   if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='planned_share_plans'").get())db.prepare('DELETE FROM planned_share_plans WHERE user_id=?').run(userId);
   if(db.prepare("PRAGMA table_info(expense_group_members)").all().some(c=>c.name==='person_key'))db.prepare('UPDATE expense_group_members SET person_key=NULL WHERE invited_by=?').run(userId);
   if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='notification_devices'").get())db.prepare('DELETE FROM notification_devices WHERE user_id=?').run(userId);
   if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='receipt_scans'").get())db.prepare('UPDATE receipt_scans SET user_id=NULL,budget_id=NULL,request_hash=NULL,result=NULL,retry_of=NULL,visible_ms=NULL WHERE user_id=?').run(userId);
   eraseGroupData(db,userId,profile?.email??'');
   if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='shared_expenses'").get()){
    // Private requests disappear on erasure. Independently recorded accounting
    // entries in the other member's budget remain their own records.
    db.prepare("DELETE FROM shared_operations WHERE json_extract(response,'$.expense.id') IN (SELECT e.id FROM shared_expenses e LEFT JOIN expense_shares s ON s.expense_id=e.id WHERE e.owner_id=? OR s.recipient_id=? OR s.email=?)").run(userId,userId,profile?.email??'');
    db.prepare('DELETE FROM expense_shares WHERE recipient_id=? OR email=?').run(userId,profile?.email??'');
    db.prepare('DELETE FROM shared_expenses WHERE owner_id=?').run(userId);
    db.prepare('DELETE FROM shared_operations WHERE user_id=?').run(userId);
   }
   for(const table of ['operation_outcomes','operation_status_limits'])if(db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(table))db.prepare('DELETE FROM '+table+' WHERE user_id=?').run(userId);
   for(const table of ['admin_stepups','admin_mfa_attempts','owner_roles','user_entitlements','coupon_redemptions','billing_requests','admin_access_grants'])if(db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(table))db.prepare('DELETE FROM '+table+' WHERE user_id=?').run(userId);
   db.prepare('DELETE FROM budgets WHERE owner_id=?').run(userId);
   if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='owner_test_budgets'").get())db.prepare('DELETE FROM owner_test_budgets WHERE owner_id=?').run(userId);
   db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
   db.prepare('DELETE FROM oauth_flows WHERE user_id=?').run(userId);
   db.prepare('DELETE FROM auth_sessions WHERE userId=?').run(userId);
   db.prepare('DELETE FROM auth_accounts WHERE userId=?').run(userId);
   db.prepare('DELETE FROM auth_verifications WHERE value=? OR value=?').run(userId,profile?.email??'');
   for(const table of ['account_links','email_preferences','email_activity','email_deliveries','email_unsubscribes'])if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))db.prepare('DELETE FROM '+table+' WHERE user_id=?').run(userId);
   db.prepare('DELETE FROM auth_users WHERE id=?').run(userId);
   const hasBilling=!!db.prepare("SELECT 1 FROM sqlite_master WHERE name='billing_checkouts'").get()&&!!db.prepare('SELECT 1 FROM billing_checkouts WHERE user_id=?').get(userId);
   if(hasBilling){
    // Keep the minimum linkage needed to reconcile provider payments/refunds.
    // No login record, address, or budget remains for this tombstone.
    db.prepare("UPDATE users SET email=?,salt='',password_hash='' WHERE id=?").run('deleted-'+userId+'@deleted.invalid',userId);
   }else db.prepare('DELETE FROM users WHERE id=?').run(userId);
   db.prepare('INSERT OR IGNORE INTO account_erasures(user_id,deleted_at) VALUES(?,?)').run(userId,deletedAt);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 function erase(userId){
  const deletedAt=Date.now();
  // Write-ahead deletion ledger is outside SQLite snapshots. Replay it before
  // reopening a restored database; if either write fails, do not claim success.
  if(ledger){const fd=openSync(ledger,'a',0o600);try{appendFileSync(fd,JSON.stringify({userId,deletedAt})+'\n');fsyncSync(fd);}finally{closeSync(fd);}}
  purge(userId,deletedAt);
  return {deleted:true};
 }
 function replay(){
  if(!ledger||!existsSync(ledger))return;
  for(const line of readFileSync(ledger,'utf8').split('\n').filter(Boolean)){
   const item=JSON.parse(line);
   if(typeof item.userId!=='string'||!/^[0-9a-f-]{36}$/.test(item.userId)||!Number.isSafeInteger(item.deletedAt))throw new Error('The account deletion ledger could not be verified.');
   if(!db.prepare('SELECT 1 FROM account_erasures WHERE user_id=?').get(item.userId))purge(item.userId,item.deletedAt);
  }
 }
 return {erase,replay};
}
