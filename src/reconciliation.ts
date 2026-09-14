import { id, today, validateBudget, effectiveEntries } from './engine';
import type { Budget, Entry } from './engine';

export const affectsAccount=(e:Entry,accountId:string)=>e.kind!=='allocation'&&(e.accountId===accountId||e.toAccountId===accountId);
export const isCleared=(e:Entry,accountId:string)=>e.toAccountId===accountId?(e.clearedTo??e.cleared):e.cleared;
export function setCleared(e:Entry,accountId:string,cleared:boolean):Entry {
 if(e.toAccountId===accountId)return {...e,clearedTo:cleared};
 return {...e,...(e.toAccountId?{clearedTo:e.clearedTo??e.cleared}:{}),cleared};
}
export function accountEffect(e:Entry,accountId:string):number {
 if(!affectsAccount(e,accountId))return 0;
 if(e.toAccountId===accountId)return e.amount;
 return (e.kind==='income'||e.kind==='refund'||e.kind==='shared_receipt'||e.kind==='shared_refund'||(e.kind==='adjustment'&&e.direction==='in'))?e.amount:-e.amount;
}
export function clearedBalance(b:Budget,accountId:string,date:string):number {
 const a=b.accounts.find(a=>a.id===accountId);
 if(!a||date<a.date)throw new Error('Choose a date on or after the account opening.');
 return a.opening+effectiveEntries(b).filter(e=>e.date<=date&&isCleared(e,accountId)).reduce((n,e)=>n+accountEffect(e,accountId),0);
}
// A compact change detector for reconciliation history; this is not a security signature.
export function reconciliationSignature(b:Budget,accountId:string,date:string):string {
 const a=b.accounts.find(a=>a.id===accountId)!;
 const rows=effectiveEntries(b).filter(e=>e.date<=date&&affectsAccount(e,accountId)&&isCleared(e,accountId)).map(e=>[e.id,e.date,accountEffect(e,accountId)]).sort((x,y)=>String(x[0]).localeCompare(String(y[0])));
 const source=JSON.stringify([a.date,a.opening,rows]);let first=2166136261,second=5381;
 for(let i=0;i<source.length;i++){first=Math.imul(first^source.charCodeAt(i),16777619);second=Math.imul(second,33)^source.charCodeAt(i);}
 return `${source.length}:${first>>>0}:${second>>>0}`;
}
export function reconcile(b:Budget,accountId:string,date:string,balance:number,reason=''):Budget {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date>today())throw new Error('Choose a valid reconciliation date that is not in the future.');
 let next=validateBudget(b);
 const difference=balance-clearedBalance(next,accountId,date);
 if(difference){
  if(!reason.trim())throw new Error('Review uncleared entries, or explicitly add an adjustment with a reason.');
  next={...next,entries:[...next.entries,{id:id(),kind:'adjustment',accountId,date,amount:Math.abs(difference),direction:difference>0?'in':'out',payee:'Balance adjustment',note:reason.trim(),cleared:true}]};
 }
 return validateBudget({...next,reconciliations:[...(next.reconciliations??[]),{id:id(),accountId,date,balance,signature:reconciliationSignature(next,accountId,date)}]});
}
