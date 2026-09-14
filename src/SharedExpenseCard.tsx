import {ArrowDownLeft,ChevronDown,ChevronRight,Pencil,Receipt,RotateCcw} from 'lucide-react';
import {money} from './engine';
import {PersonAvatar,RepaymentProgress,ShareStatus} from './PeopleOverview';
import {peopleActionLabel,shareAmounts,shareClosed,shareNextAction} from './people-presentation';
import type {PeopleAction} from './people-presentation';
import type {Expense,Payment,Settlement,Share} from './SharedExpenses';

type Props={
 expense:Expense;shares:Share[];payerName:string;budgetId:string;groupVersion?:number;
 expanded:boolean;onToggle:()=>void;onAction:(share:Share,action:PeopleAction,controlId?:string)=>void;
 onRespond:(share:Share,action:string)=>void;onInvite:(share:Share)=>void;
 onPayment:(payment:Payment)=>void;onDispute:(settlement:Settlement)=>void;
 onReceipt:()=>void;onReviewChange:(id:string)=>void;onGroup:()=>void;
 onChange:(kind:'correct'|'refund'|'reverse_payment',settlement?:Settlement)=>void;
};
const dateLabel=(value:string)=>new Date(value+'T12:00:00').toLocaleDateString('en-US',{day:'numeric',month:'short',year:'numeric'});

export default function SharedExpenseCard({expense,shares,payerName,budgetId,groupVersion,expanded,onToggle,onAction,onRespond,onInvite,onPayment,onDispute,onReceipt,onReviewChange,onGroup,onChange}:Props){
 const fmt=(value:number)=>money(value,expense.currency);
 const canCorrect=groupVersion===1&&expense.owned&&expense.kind!=='refund'&&(expense.ledgerVersion??1)>=2;
 const active=shares.filter(share=>!shareClosed(expense,share)),balance=active.reduce((sum,share)=>sum+shareAmounts(share).balance,0);
 const quickAction=shares.length===1?shareNextAction(expense,shares[0]):undefined;
 const closedLabel=shares.every(share=>share.state==='cancelled')?'Cancelled':shares.every(share=>share.state==='declined')?'Declined':shares.every(share=>share.state==='refunded')?'Refunded':shares.some(share=>['cancelled','declined'].includes(share.state))?'Closed':'Settled';
 const balanceLabel=!expense.owned&&active.every(share=>share.state==='invited')?'Requested from you':expense.owned?(expense.ledgerVersion??1)<2&&active.every(share=>share.state==='invited')?'Requested by you':'Owed to you':'You owe';
 const description=expense.kind==='refund'?(expense.owned?'Refund owed to you':'Refund to return'):expense.combinedBillId?(expense.owned?'You contributed to the bill':'Contribution from '+payerName):expense.owned?'You paid the bill':'Paid by '+payerName;
 function paymentRow(share:Share,settlement:Settlement){
  const needsImport=!expense.owned&&share.state==='accepted'&&settlement.state==='confirmed'&&settlement.recordedByPayer&&settlement.recordedInYourBudget===false;
  const needsReceipt=expense.owned&&['pending','disputed'].includes(settlement.state);
  const description=settlement.state==='reversed'?'Repayment record reversed':settlement.state==='confirmed'?(expense.owned?'Money received':'Repayment confirmed'):settlement.state==='disputed'?'Repayment disputed':expense.owned?'Repayment reported':'You recorded a repayment';
  return <div key={settlement.id} className={'shared-payment '+(needsReceipt||needsImport?'needs-action':'')}>
   <div className="shared-payment-label"><strong>{description}</strong><span>{fmt(settlement.amount)} · {dateLabel(settlement.date)}</span></div>
   {settlement.state==='pending'&&<p>{expense.owned?'Confirm only after this money reaches your account.':`Waiting for ${payerName} to confirm they received your repayment. Do not record it again.`}</p>}
   {settlement.state==='disputed'&&<p>{expense.owned?'This repayment was marked as not received. Check your account before confirming.':`${payerName} marked this repayment as not received. Check with them before recording another.`}</p>}
   {settlement.recordedByPayer&&<p className="small muted">{expense.owned?'Recorded by you':'Recorded by the original payer'}</p>}
   {needsImport&&<><p>The payer confirmed they received your repayment. Add it to your budget only if you paid and have not already recorded it.</p><button className="button secondary" onClick={()=>onPayment({expense,share,settlement,importReceived:true})}>Add payment to my budget</button></>}
   {needsReceipt&&<div className="button-row"><button className="button primary" onClick={()=>onPayment({expense,share,settlement})}>Confirm money received</button>{settlement.state==='pending'&&<button className="button ghost" onClick={()=>onDispute(settlement)}>Payment not received</button>}</div>}
   {groupVersion===1&&settlement.state!=='reversed'&&(expense.owned?settlement.state==='confirmed':!settlement.recordedByPayer||settlement.recordedInYourBudget)&&<button className="text-button" onClick={()=>onChange('reverse_payment',settlement)}><RotateCcw size={15} aria-hidden="true"/>Reverse repayment record</button>}
  </div>;
 }
 return <article className={'shared-card '+(expanded?'is-expanded':'')}>
  <header className="shared-bill-summary">
   <button id={'bill-toggle-'+expense.id} type="button" className="shared-bill-toggle" aria-label={(expanded?'Hide':'Show')+' details for '+(expense.merchant||'Shared purchase')} aria-expanded={expanded} aria-controls={'bill-details-'+expense.id} onClick={onToggle}><span className="shared-bill-icon"><Receipt size={19} aria-hidden="true"/></span><span><strong>{expense.merchant||'Shared purchase'}</strong><small>{dateLabel(expense.date)} · {description}</small></span><ChevronDown size={16} aria-hidden="true"/></button>
   <div className="shared-bill-balance">{active.length?<><span>{balanceLabel}</span><strong>{fmt(balance)} <small>{expense.currency}</small></strong></>:<span className="shared-closed">{closedLabel}</span>}</div>
   {!expanded&&quickAction&&<button id={'bill-action-'+expense.id} type="button" className="button secondary shared-quick-action" onClick={event=>onAction(shares[0],quickAction,event.currentTarget.id)}>{peopleActionLabel(quickAction,expense,shares[0])}</button>}
  </header>
  <div className="shared-bill-details" id={'bill-details-'+expense.id} hidden={!expanded}>{expanded&&<>
  <div className="shared-bill-facts"><div className="shared-bill-total"><span>{expense.kind==='refund'?'Refund total':expense.combinedBillId?'Payment within group bill':'Bill total'} · {expense.currency}</span><strong>{fmt(expense.total)}</strong></div>{expense.groupName&&<button type="button" className="text-button shared-group-link" onClick={onGroup}>{expense.groupName}<ChevronRight size={13} aria-hidden="true"/></button>}</div>
  {expense.hasReceipt&&<button className="text-button shared-receipt" onClick={onReceipt}><Receipt size={15} aria-hidden="true"/>View bill</button>}
  {shares.map(share=>{
   const amounts=shareAmounts(share),name=expense.owned?(share.name||share.email||'This person'):payerName,closed=shareClosed(expense,share);
   const waiting=share.state==='invited',canReceive=expense.owned&&['invited','accepted','declined'].includes(share.state)&&amounts.unrecorded>0;
   const canRepay=!expense.owned&&share.state==='accepted'&&amounts.unrecorded>0;
   const attention=share.settlements.filter(payment=>['pending','disputed'].includes(payment.state)||(!expense.owned&&share.state==='accepted'&&payment.state==='confirmed'&&payment.recordedByPayer&&payment.recordedInYourBudget===false));
   const recorded=share.settlements.filter(payment=>!attention.includes(payment));
   const label=share.state==='cancelled'?'Cancelled share':share.state==='refunded'?'Refunded share':!expense.owned&&waiting?'Your requested share':closed?'No outstanding balance':expense.owned&&waiting&&(expense.ledgerVersion??1)<2?'Requested from '+name:expense.owned?name+' still owes you':'You still owe '+name;
   return <section className="shared-participant" key={share.id} aria-label={expense.owned?'Share for '+name:'Your share'}>
    {share.reviewPending&&<div className="group-recovery"><p>A change to this share is awaiting review.</p>{share.pendingChangeId&&<button className="button secondary" onClick={()=>onReviewChange(share.pendingChangeId!)}>Review change</button>}</div>}
    <fieldset disabled={share.reviewPending} className="shared-share">
     <div className="shared-person-heading"><PersonAvatar name={expense.owned?name:'You'} identity={share.personKey??share.email}/><div><span className="shared-balance-label">{shares.length===1?(expense.owned?name+"’s share":"Your share"):label}</span>{!closed&&shares.length>1&&<strong className="shared-balance">{fmt(!expense.owned&&waiting?share.amount:amounts.balance)} <small>{expense.currency}</small></strong>}{closed&&<strong className="shared-closed">{share.state==='cancelled'?'Cancelled':share.state==='refunded'?'Refunded':share.state==='declined'?'Declined':'Settled'}</strong>}</div><div className="shared-person-status"><ShareStatus state={share.state} owned={expense.owned}/>{!closed&&share.confirmed+share.pending+(share.offset??0)===0&&<span>{share.settlements.length?'No active repayment record':'No repayment recorded'}</span>}</div></div>
     {!closed&&(share.amount!==amounts.balance||share.state==='declined')&&<p className="shared-share-description">Share amount: {fmt(share.amount)}. {share.state==='declined'&&expense.owned&&(expense.ledgerVersion??1)>=2?'This amount stays recorded as owed to you until you cancel the request.':''}</p>}
     <RepaymentProgress {...share} owned={expense.owned} currency={expense.currency} cancelled={share.state==='cancelled'}/>
     {attention.map(payment=>paymentRow(share,payment))}
     <div className="shared-share-actions">
      {waiting&&(expense.owned?<><button className="button secondary" onClick={()=>onInvite(share)}>{expense.groupId?'View group invitations':'Invite by message'}</button>{!share.settlements.length&&!share.refunded&&<button className="text-button" onClick={()=>onRespond(share,'cancel')}>Cancel request</button>}</>:<><button className="button primary" onClick={()=>onRespond(share,'accept')}>{(expense.ledgerVersion??1)>=2?'Review share':'Accept share'}</button><button className="button ghost" onClick={()=>onRespond(share,'decline')}>Decline</button></>)}
      {canReceive&&<button className={'button '+(!share.pending?'primary':'secondary')} onClick={()=>onPayment({expense,share,receiveOffline:true})}><ArrowDownLeft size={16} aria-hidden="true"/>{share.pending>0?'Record another payment received':'Record money received'}</button>}
      {canRepay&&<button className={'button '+(share.pending>0?'secondary':'primary')} onClick={()=>onPayment({expense,share})}>{share.pending>0?'Record another repayment':'Record repayment'}</button>}
      {share.state==='declined'&&expense.owned&&(expense.ledgerVersion??1)>=2&&!share.settlements.length&&<button className="text-button" onClick={()=>onRespond(share,'cancel')}>Keep this share as my spending</button>}
     </div>
     {recorded.length>0&&<details className="shared-payment-history"><summary>Repayment history ({recorded.length})</summary>{recorded.map(payment=>paymentRow(share,payment))}</details>}
    </fieldset>
   </section>;
  })}
  {canCorrect&&<details className="shared-bill-actions"><summary>Bill actions<ChevronDown size={14} aria-hidden="true"/></summary><div className="button-row"><button className="text-button" disabled={expense.budgetId!==budgetId||expense.shares.some(share=>share.reviewPending)} onClick={()=>onChange('correct')}><Pencil size={15} aria-hidden="true"/>Correct bill</button><button className="text-button" disabled={expense.budgetId!==budgetId||expense.shares.some(share=>share.reviewPending)} onClick={()=>onChange('refund')}><RotateCcw size={15} aria-hidden="true"/>Record shared refund</button></div>{expense.budgetId!==budgetId&&<p>Open the budget used for this bill to edit it.</p>}</details>}
  </>}</div>
 </article>;
}
