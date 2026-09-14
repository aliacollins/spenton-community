import {calculate,validateBudget} from './engine';
import type {Budget,Entry} from './engine';
import type {BillPlan} from './group-bill-plan';
export function previewGroupBill(budget:Budget,plan:BillPlan,memberId:string,accountId:string,categoryId:string,date:string,merchant:string){
 const payer=plan.payers.find(p=>p.memberId===memberId);
 if(!payer)return null;
 const prefix='group-bill-preview-',entries:Entry[]=[{id:prefix+'purchase',kind:'expense',amount:payer.amount,date,accountId,categoryId,payee:merchant||'Group bill',note:'',cleared:false,sharedExpenseId:prefix+memberId,sharedAmount:payer.parts.filter(p=>p.memberId!==memberId).reduce((n,p)=>n+p.amount,0)}];
 for(const other of plan.payers)if(other.memberId!==memberId){const part=other.parts.find(p=>p.memberId===memberId);if(part?.amount)entries.push({id:prefix+other.memberId,kind:'shared_charge',amount:part.amount,date,categoryId,payee:merchant||'Group bill',note:'',cleared:true,sharedExpenseId:prefix+other.memberId,sharedShareId:prefix+'share-'+other.memberId});}
 const after=calculate(validateBudget({...budget,version:3,entries:[...budget.entries,...entries]}),date.slice(0,7));
 return {paid:payer.amount,personalSpending:plan.people.find(p=>p.memberId===memberId)?.amount??0,receivable:payer.parts.filter(p=>p.memberId!==memberId).reduce((n,p)=>n+p.amount,0),categoryLeft:after.categories[categoryId].available,ready:after.ready,cash:after.cash};
}
