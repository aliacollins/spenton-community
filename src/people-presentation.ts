import type {Expense,Share,Settlement} from './SharedExpenses';
import type {PersonBalance,PeopleFilter} from './PeopleOverview';

export function shareAmounts(share:Pick<Share,'amount'|'confirmed'|'pending'|'offset'>){
 const offset=share.offset??0;
 // Pending payments still belong to the unsettled balance. Subtract them only
 // when finding how much could be recorded without duplicating a payment.
 const balance=Math.max(0,share.amount-share.confirmed-offset);
 return {balance,unrecorded:Math.max(0,balance-share.pending),confirmed:share.confirmed,pending:share.pending,offset};
}

export function shareClosed(expense:Pick<Expense,'ledgerVersion'|'owned'>,share:Share){
 return share.state==='cancelled'||share.state==='refunded'||(share.state==='declined'&&(!expense.owned||(expense.ledgerVersion??1)<2))||(shareAmounts(share).balance===0&&share.pending===0);
}

export function visibleShares(expense:Expense,person=''){
 return expense.shares.filter(share=>!person||!expense.owned||(share.personKey??share.email)===person);
}

export function matchingShares(expense:Expense,person:string,filter:PeopleFilter){
 return visibleShares(expense,person).filter(share=>{
  const closed=shareClosed(expense,share);
  return filter==='all'||filter==='settled'&&closed||filter==='incoming'&&expense.owned&&!closed||filter==='outgoing'&&!expense.owned&&!closed;
 });
}

export function peopleCurrencyTotals(balances:PersonBalance[]){
 const totals=new Map<string,{currency:string;incoming:number;outgoing:number;requested:number}>();
 for(const person of balances){
  const row=totals.get(person.currency)??{currency:person.currency,incoming:0,outgoing:0,requested:0};
  row.incoming+=person.owedToYou;row.outgoing+=person.youOwe;
  // Incoming requests are not accepted debt. Requests sent by the owner may
  // already be included in incoming, so never add them to that balance again.
  row.requested+=person.requestedFromYou;
  totals.set(person.currency,row);
 }
 return [...totals.values()].filter(row=>row.incoming||row.outgoing||row.requested||balances.some(p=>p.currency===row.currency&&p.requestedToYou>0)).sort((a,b)=>a.currency.localeCompare(b.currency));
}

export function currencyName(code:string){
 try{return new Intl.DisplayNames(['en'],{type:'currency'}).of(code)??code;}catch{return code;}
}

export function paymentPriority(expense:Expense,person=''){
 const shares=visibleShares(expense,person);
 if(shares.some(s=>shareReviewActions(expense,s).some(action=>action.kind!=='accept')))return 0;
 if(!expense.owned&&shares.some(s=>s.state==='invited'))return 1;
 return shares.some(s=>!shareClosed(expense,s))?2:3;
}

export type PeopleAction=
 |{kind:'confirm'|'import';settlement:Settlement}
 |{kind:'accept'|'receive'|'repay'|'details'}
 |{kind:'change';changeId:string};

/** Actions the viewer can resolve, distinct from waiting on another person. */
export function shareReviewActions(expense:Expense,share:Share):PeopleAction[]{
 if(share.reviewPending)return share.pendingChangeId?[{kind:'change',changeId:share.pendingChangeId}]:[{kind:'details'}];
 if(['cancelled','refunded'].includes(share.state)||!expense.owned&&share.state==='declined')return [];
 if(expense.owned)return share.settlements.filter(payment=>['pending','disputed'].includes(payment.state)).map(settlement=>({kind:'confirm',settlement}));
 if(share.state==='invited')return [{kind:'accept'}];
 if(share.state==='accepted')return share.settlements.filter(payment=>payment.state==='confirmed'&&payment.recordedByPayer&&payment.recordedInYourBudget===false).map(settlement=>({kind:'import',settlement}));
 return [];
}

export function shareNextAction(expense:Expense,share:Share):PeopleAction|undefined{
 const reviews=shareReviewActions(expense,share);
 if(reviews.length>1)return {kind:'details'};
 if(reviews.length)return reviews[0];
 if(shareClosed(expense,share)||shareAmounts(share).unrecorded===0)return;
 if(expense.owned&&['invited','accepted','declined'].includes(share.state))return {kind:'receive'};
 if(!expense.owned&&share.state==='accepted')return {kind:'repay'};
}

export function peopleActionLabel(action:PeopleAction,expense:Expense,share:Share){
 switch(action.kind){
  case 'confirm':return 'Confirm money received';
  case 'import':return 'Add payment to my budget';
  case 'accept':return (expense.ledgerVersion??1)>=2?'Review share':'Accept share';
  case 'receive':return 'Record money received';
  case 'repay':return share.pending>0?'Record another repayment':'Record repayment';
  case 'change':return 'Review change';
  case 'details':return 'View bill details';
 }
}

export function personBalanceHint(people:PersonBalance[]){
 if(people.some(person=>person.pendingToYou>0))return 'Repayment to review';
 if(people.some(person=>person.requestedFromYou>0))return 'New share to review';
 if(people.some(person=>person.pendingFromYou>0))return 'Waiting for repayment confirmation';
 if(people.some(person=>person.requestedToYou>0))return 'Some shares not accepted yet';
 return '';
}

export function acceptanceLabel(state:string,owned:boolean){
 if(state==='cancelled')return 'Share cancelled';
 if(state==='refunded')return 'Share refunded';
 if(state==='declined')return 'Share declined';
 if(state==='invited')return owned?'Share not accepted':'Your review is needed';
 if(state==='accepted')return 'Share accepted';
 return 'Share status unavailable';
}
