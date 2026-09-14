class AccessError extends Error {
  constructor(status,code,message){super(message);Object.assign(this,{status,code});}
}
const unavailable=()=>{throw new AccessError(404,'CLOUD_SERVICE_UNAVAILABLE','This Cloud service is not used on your server.');};
export const isError=error=>error instanceof AccessError;

// Product limits are independent of paying for the official managed service.
export function createCouponService(db){
 db.exec(`CREATE TABLE IF NOT EXISTS user_entitlements(
   user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
   budget_credits INTEGER NOT NULL DEFAULT 0,access_expires_at INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL) STRICT;`);
 return {
  isAdmin:()=>false,
  usage:user=>{
   if(!db.prepare('SELECT 1 FROM users WHERE id=?').get(user))throw new AccessError(404,'USER_NOT_FOUND','Account not found.');
   const credits=db.prepare('SELECT budget_credits FROM user_entitlements WHERE user_id=?').get(user)?.budget_credits??0;
   return {budgetCredits:credits,budgetLimit:3+credits,budgetCount:db.prepare('SELECT count(*) n FROM budgets WHERE owner_id=?').get(user).n,accessExpiresAt:null};
  },
  redeem:unavailable,
 };
}
export function createBillingService(db){
 const status=user=>{
  if(!db.prepare('SELECT 1 FROM users WHERE id=?').get(user))throw new AccessError(404,'USER_NOT_FOUND','Account not found.');
  return {state:'self-hosted',canEdit:true,disputeHold:false,trialDays:0,trialEndsAt:null,accessEndsAt:null,daysRemaining:0,
   offers:{monthly:{amountMinor:799,currency:'USD',recurring:true,available:false},annual:{amountMinor:7900,currency:'USD',recurring:false,available:false}},checkout:null};
 };
 return {status,requireEditing:user=>{status(user);},capabilities:()=>({checkoutEnabled:false,monthlyEnabled:false}),
  history:{record:()=>{},personal:()=>null},tick:async()=>{}};
}
export const createOwnerOperations=()=>({});
export const createOwnerTestingService=()=>({});
export const createAdminPasskeyService=unavailable;
export const createAccountResetService=()=>({review:()=>({request:null}),assertCreation:()=>{},confirm:unavailable,cancel:unavailable});
