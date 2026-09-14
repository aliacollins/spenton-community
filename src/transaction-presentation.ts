import type {Budget,Entry} from './engine';
import {accountEffect,isCleared} from './reconciliation';

export function transactionKindLabel(entry:Entry):string{
 const labels:Record<Entry['kind'],string>={
  expense:entry.sharedAmount!==undefined?'Shared purchase':'Purchase',income:'Income',
  payment:'Card payment',transfer:'Transfer',allocation:'Set aside',refund:'Linked refund',
  adjustment:'Balance adjustment',shared_charge:'Shared purchase',shared_payment:'Shared repayment',
  shared_receipt:'Money received',shared_offset:'Offset, no cash movement',shared_refund:'Shared refund',
  shared_credit:'Share refund',shared_claim:'Refund owed to you',shared_return:'Refund you owe',
  shared_void:'Reversed shared entry',
 };
 return labels[entry.kind];
}

/** Display account movements using the same signs as reconciliation. No ledger changes. */
export function transactionPresentation(budget:Budget,entry:Entry,accountFilter='all'){
 const source=budget.accounts.find(account=>account.id===entry.accountId);
 const destination=budget.accounts.find(account=>account.id===entry.toAccountId);
 const transfer=entry.kind==='transfer'||entry.kind==='payment';
 const accountId=accountFilter==='all'?entry.accountId:accountFilter;
 const account=budget.accounts.find(account=>account.id===accountId);
 const effect=accountId?accountEffect(entry,accountId):0;
 const movement: 'in'|'out'|'between'|'none'=transfer&&accountFilter==='all'?'between':!entry.accountId?'none':effect>0?'in':effect<0?'out':'none';
 const accountName=account?.name??(entry.accountId?'Account unavailable':entry.kind==='shared_charge'?'Paid by someone else':'No cash movement');
 const relation=transfer?(accountFilter===entry.toAccountId?'From '+(source?.name??'another account'):'To '+(destination?.name??'another account')):'';
 const clearedFrom=entry.accountId?isCleared(entry,entry.accountId):false;
 const clearedTo=entry.toAccountId?isCleared(entry,entry.toAccountId):false;
 return {
  source,destination,transfer,accountId,accountName,relation,movement,
  sign:movement==='in'?'+':movement==='out'?'−':'',
  cleared:accountId?isCleared(entry,accountId):false,
  reviewClearing:transfer&&accountFilter==='all',
  allCleared:clearedFrom&&clearedTo,
  mixedClearing:transfer&&clearedFrom!==clearedTo,
  uncleared:!!entry.accountId&&(transfer&&accountFilter==='all'?!(clearedFrom&&clearedTo):accountId?!isCleared(entry,accountId):false),
  kindLabel:transactionKindLabel(entry),
 };
}
