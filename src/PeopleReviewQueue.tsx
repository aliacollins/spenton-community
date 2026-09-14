import {ArrowRight,ClipboardCheck} from 'lucide-react';
import {money} from './engine';
import {PersonAvatar,personName} from './PeopleOverview';
import type {PersonBalance} from './PeopleOverview';
import type {Expense,Share} from './SharedExpenses';
import {peopleActionLabel,shareReviewActions} from './people-presentation';
import type {PeopleAction} from './people-presentation';

export default function PeopleReviewQueue({rows,balances,hasMore,expanded,onExpand,onAction}:{
 rows:{expense:Expense;shares:Share[]}[];balances:PersonBalance[];hasMore:boolean;
 expanded:boolean;onExpand:()=>void;
 onAction:(expense:Expense,share:Share,action:PeopleAction,controlId?:string)=>void;
}){
 const items=rows.flatMap(({expense,shares})=>shares.flatMap(share=>shareReviewActions(expense,share).map(action=>({expense,share,action}))));
 if(!items.length)return null;
 return <section className="people-review-queue" aria-labelledby="people-review-title">
  <header><div><ClipboardCheck size={18} aria-hidden="true"/><h2 id="people-review-title">Needs your review</h2><span>{items.length}</span></div>{hasMore&&<p>From the bills loaded so far.</p>}</header>
  <div className="people-review-list">{(expanded?items:items.slice(0,3)).map(({expense,share,action})=>{
   const payer=balances.find(person=>person.email===expense.payer);
   const name=expense.owned?(share.name||share.email||'This person'):payer?personName(payer):expense.payer;
   const amount=money('settlement' in action?action.settlement.amount:share.amount,expense.currency);
   const title=action.kind==='confirm'?(action.settlement.state==='disputed'?`Check the ${amount} repayment from ${name}`:`${name} reported a ${amount} repayment`):action.kind==='accept'?`${name} asked you to share ${amount}`:action.kind==='import'?`${name} confirmed your ${amount} repayment`:'A change to this bill needs review';
   const key=expense.id+'-'+share.id+'-'+('settlement' in action?action.settlement.id:action.kind);
   return <div className="people-review-row" key={key}>
    <PersonAvatar name={name} identity={expense.owned?share.personKey??share.email:expense.payer}/>
    <div><h3>{title}</h3><p>{expense.merchant||'Shared purchase'} · {expense.currency}{action.kind==='confirm'&&' · Check your account before confirming.'}{action.kind==='accept'&&' · Review it before accepting.'}{action.kind==='import'&&' · Check whether it is in your budget.'}</p></div>
    <button id={'people-review-'+key} type="button" className="button secondary" onClick={event=>onAction(expense,share,action,event.currentTarget.id)}>{peopleActionLabel(action,expense,share)}<ArrowRight size={15} aria-hidden="true"/></button>
   </div>;
  })}</div>
  {items.length>3&&<button type="button" className="text-button people-review-more" onClick={onExpand}>{expanded?'Show fewer reviews':`Show all ${items.length} reviews`}</button>}
 </section>;
}
