import { calculate, monthEnd, spendingAmount, effectiveEntries, personalCategoryParts, sharedRefundCategoryParts } from './engine';
import type { Budget, CategoryTotal, Entry } from './engine';

export type CategoryHistoryRow={
 entry:Entry;
 date:string;
 kind:Entry['kind'];
 amount:number;
 from:string;
 to:string;
 accountName?:string;
 isCard:boolean;
 split:boolean;
 scope:'category'|'card';
 assignmentDelta:number;
 spendingDelta:number;
};
export type CategoryMonthExplanation=CategoryTotal&{
 assignedIn:number;
 assignedOut:number;
 purchases:number;
 refunds:number;
};

/** Source amounts describe assignments or spending activity, never inferred cash changes. */
export function categoryHistory(budget:Budget,categoryId:string,month:string,includeEarlier=false):{rows:CategoryHistoryRow[];cardContext:CategoryHistoryRow[]}{
 const category=budget.categories.find(item=>item.id===categoryId);
 if(!category)throw new Error('Choose an existing category.');
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('Choose a valid month.');
 const end=monthEnd(month),start=month+'-01';
 const accounts=new Map(budget.accounts.map(account=>[account.id,account]));
 const categoryNames=new Map(budget.categories.map(item=>[item.id,item.name]));
 const bucket=(value:string|undefined)=>value==='ready'?'Available to plan':value?.startsWith('card:')?(accounts.get(value.slice(5))?.name??'Card')+' cash set aside':categoryNames.get(value??'')??'Unknown category';
 const share=(entry:Entry)=>{
  const parts=entry.kind==='expense'?personalCategoryParts(entry):entry.kind==='shared_refund'?sharedRefundCategoryParts(budget,entry):entry.splits;
  return parts?parts.filter(part=>part.categoryId===categoryId).reduce((sum,part)=>sum+part.amount,0):entry.categoryId===categoryId?Math.abs(spendingAmount(entry)):0;
 };
 const relatedCards=new Set(effectiveEntries(budget).filter(entry=>entry.date<=end&&(entry.kind==='expense'||entry.kind==='refund'||entry.kind==='shared_refund')&&share(entry)>0&&accounts.get(entry.accountId??'')?.type==='credit').map(entry=>entry.accountId!));
 const rows:CategoryHistoryRow[]=[],cardContext:CategoryHistoryRow[]=[];
 const sources=effectiveEntries(budget).map((entry,index)=>({entry,index})).filter(({entry})=>entry.date<=end&&(includeEarlier||entry.date>=start)).sort((a,b)=>b.entry.date.localeCompare(a.entry.date)||b.index-a.index);
 for(const {entry} of sources){
  const account=accounts.get(entry.accountId??'');
  const base={entry,date:entry.date,kind:entry.kind,amount:entry.amount,accountName:account?.name,isCard:account?.type==='credit',split:!!entry.splits,assignmentDelta:0,spendingDelta:0};
  if(entry.kind==='allocation'&&(entry.from===categoryId||entry.to===categoryId)){
   rows.push({...base,scope:'category',from:bucket(entry.from),to:bucket(entry.to),assignmentDelta:entry.to===categoryId?entry.amount:-entry.amount});
   continue;
  }
  const amount=(entry.kind==='expense'||entry.kind==='refund'||entry.kind==='shared_refund'||entry.kind==='shared_charge'||entry.kind==='shared_credit')?share(entry):0;
  if(amount){
   rows.push({...base,amount,scope:'category',from:spendingAmount(entry)>=0?category.name:entry.payee||'Merchant',to:spendingAmount(entry)>=0?entry.payee||'Merchant':category.name,spendingDelta:spendingAmount(entry)>=0?amount:-amount});
   continue;
  }
  const reserveRelated=entry.kind==='allocation'&&[entry.from,entry.to].some(value=>value?.startsWith('card:')&&relatedCards.has(value.slice(5)));
  const paymentRelated=entry.kind==='payment'&&relatedCards.has(entry.toAccountId??'');
  const creditRelated=(entry.kind==='adjustment'||entry.kind==='refund')&&relatedCards.has(entry.accountId??'');
  if(reserveRelated||paymentRelated||creditRelated){
   cardContext.push({...base,scope:'card',isCard:true,from:entry.kind==='allocation'?bucket(entry.from):entry.kind==='payment'?account?.name??'Cash account':entry.payee||'Card adjustment',to:entry.kind==='allocation'?bucket(entry.to):accounts.get(entry.toAccountId??entry.accountId??'')?.name??'Credit card'});
  }
 }
 return {rows,cardContext};
}

export function explainCategoryMonth(budget:Budget,categoryId:string,month:string):CategoryMonthExplanation{
 const {rows}=categoryHistory(budget,categoryId,month);
 const total=calculate(budget,month).categories[categoryId];
 return {...total,
  assignedIn:rows.reduce((sum,row)=>sum+Math.max(0,row.assignmentDelta),0),
  assignedOut:rows.reduce((sum,row)=>sum+Math.max(0,-row.assignmentDelta),0),
  purchases:rows.filter(row=>(row.kind==='expense'||row.kind==='shared_charge')).reduce((sum,row)=>sum+row.amount,0),
  refunds:rows.filter(row=>row.spendingDelta<0).reduce((sum,row)=>sum+row.amount,0),
 };
}
