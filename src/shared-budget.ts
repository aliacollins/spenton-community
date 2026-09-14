import {calculate, today, validateBudget} from './engine';
import type {Budget} from './engine';

/** Previews use the same ledger as saved changes and never mutate the input. */
export function previewSharedBudget(budget:Budget,command:Record<string,string>,date=today()){
 const entries=budget.entries.slice();
 let categoryId:string|undefined=command.categoryId,accountId:string|undefined=command.accountId;
 if(command.kind==='split'){
  const index=entries.findIndex(e=>e.id===command.entryId);
  if(index<0)throw new Error('Choose a recorded purchase.');
  const entry=entries[index];
  if(entry.kind!=='expense'||entry.sharedExpenseId||entry.sharedSettlementId)throw new Error('Choose a purchase that has not been shared.');
  categoryId=entry.categoryId??entry.splits?.[0]?.categoryId;accountId=entry.accountId;
  entries[index]={...entry,sharedExpenseId:'preview:expense',sharedAmount:Number(command.amount)};
 }else if(command.kind==='accept'){
  entries.push({id:'preview:charge',kind:'shared_charge',amount:Number(command.amount),date:command.date,
   categoryId,sharedExpenseId:'preview:expense',sharedShareId:'preview:share',payee:'Shared purchase',note:'',cleared:true});
 }else throw new Error('Choose a shared-expense action.');
 const next=validateBudget({...budget,version:budget.version===3?3:2,entries});
 const totals=calculate({...next,entries:next.entries.filter(e=>e.date<=date)},date.slice(0,7));
 return {ready:totals.ready,categoryLeft:totals.categories[categoryId!].available,
  categoryAmounts:entries.find(e=>e.id===command.entryId)?.splits?.map(p=>({categoryId:p.categoryId,left:totals.categories[p.categoryId].available,spent:totals.categories[p.categoryId].spent})),
  reserved:totals.shared.obligations['preview:share']?.reserve??0,
  unfunded:totals.shared.obligations['preview:share']?Number(command.amount)-totals.shared.obligations['preview:share'].reserve:0,
  cardReserve:accountId?totals.cards[accountId]?.reserve??0:0,
  personalSpending:command.kind==='split'?entries.find(e=>e.id===command.entryId)!.amount-Number(command.amount):Number(command.amount)};
}
