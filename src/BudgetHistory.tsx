import { useMemo, useState } from 'react';
import { ArrowRight, ArrowUpRight, History, CircleHelp } from 'lucide-react';
import { Modal } from './ui';
import { money, isSharedEntry } from './engine';
import type { Budget, Entry } from './engine';
import { categoryHistory, explainCategoryMonth } from './budget-history';
import type { CategoryHistoryRow } from './budget-history';
import './budget-history.css';

type Props={budget:Budget;categoryId:string;month:string;onOpenTransaction?:(entry:Entry)=>void};

export default function BudgetHistory({budget,categoryId,month,onOpenTransaction}:Props){
 const [includeEarlier,setIncludeEarlier]=useState(false);
 const [expanded,setExpanded]=useState(false);
 const [explaining,setExplaining]=useState(false);
 const history=useMemo(()=>categoryHistory(budget,categoryId,month,includeEarlier),[budget,categoryId,month,includeEarlier]);
 const summary=useMemo(()=>explainCategoryMonth(budget,categoryId,month),[budget,categoryId,month]);
 const fmt=(amount:number)=>money(amount,budget.currency);
 const signed=(amount:number)=>(amount>0?'+':'')+fmt(amount);
 const name=budget.categories.find(category=>category.id===categoryId)?.name??'Category';
 const rows=expanded?history.rows:history.rows.slice(0,3);
 const describe=(row:CategoryHistoryRow)=>row.kind==='shared_charge'?'Accepted share':row.kind==='allocation'?'Money moved':row.kind==='expense'?row.isCard?'Card purchase':'Purchase':row.isCard?'Card refund':'Refund';
 function renderRow(row:CategoryHistoryRow){
  const allocation=row.kind==='allocation';
  const change=allocation?row.assignmentDelta:-row.spendingDelta;
  return <li key={row.entry.id} className="budget-history-row"><div className="budget-history-row-top"><time dateTime={row.date}>{row.date}</time><span>{describe(row)}{row.split?' · Split share':''}</span><strong className={change<0?'history-out':'history-in'}>{signed(change)}</strong></div><div className="budget-history-route"><span>{row.from}</span><ArrowRight size={12} aria-hidden="true"/><span>{row.to}</span></div>
   {row.accountName&&<small>{row.accountName}{row.split?' · '+fmt(row.amount)+' of '+fmt(row.entry.amount):''}</small>}
   {row.entry.note&&<p className="budget-history-note">{row.entry.note}</p>}
   {!allocation&&!isSharedEntry(row.entry)&&onOpenTransaction&&<button type="button" className="text-button" aria-label={'Open '+row.entry.payee+' '+row.kind+' from history'} onClick={()=>onOpenTransaction(row.entry)}>Open transaction<ArrowUpRight size={12}/></button>}
  </li>;
 }
 return <section className="budget-history" aria-label={'Money movement history for '+name}><button type="button" className="text-button balance-help" onClick={()=>setExplaining(true)}><CircleHelp size={14}/>How this balance works</button><h3><History size={15}/>Recent activity</h3>
  {explaining&&<Modal title="How this balance works" eyebrow={name} onClose={()=>setExplaining(false)}><div className="form-body category-balance-help"><p>“Left” is what remains for {name} in {new Date(month+'-01T12:00:00').toLocaleDateString('en-US',{month:'long',year:'numeric'})}.</p><dl><div><dt>Carried into this month</dt><dd>{fmt(summary.carry)}</dd></div><div><dt>{summary.assigned<0?'Moved out this month':'Set aside this month'}</dt><dd>{fmt(Math.abs(summary.assigned))}</dd></div><div><dt>Purchases</dt><dd>{fmt(summary.purchases)}</dd></div><div><dt>Refunds</dt><dd>{fmt(summary.refunds)}</dd></div></dl><p>Set aside adds money moved in and subtracts money moved out this month. A negative total means more moved out, including money carried over from earlier months. Money left from earlier months carries forward. Purchases reduce what is left; refunds can return money to the category.</p><dl className="budget-history-equation"><div><dt>Cash still in this category</dt><dd>{fmt(summary.cash)}</dd></div>{summary.unfunded>0&&<div><dt>Minus purchases and shares still needing cash</dt><dd>{fmt(summary.unfunded)}</dd></div>}<div><dt>Left in this category</dt><dd>{fmt(summary.available)}</dd></div></dl><h3>When you split a purchase</h3><p>Only your share counts as spending. Accepting a share sets aside available cash for repayment. Paying or receiving a repayment does not count as spending again.</p><h3>When you use a credit card</h3><p>Covered purchases move category cash into cash set aside for the card. Paying the card uses that cash without counting the purchase again.</p><p>Card credit can cover a purchase without using category cash. A refund can return cash still set aside for the purchase. After payment, it may reduce card debt or become card credit.</p></div><div className="modal-footer"><button type="button" className="button primary" onClick={()=>setExplaining(false)}>Got it</button></div></Modal>}

  <label className="budget-history-toggle"><input type="checkbox" checked={includeEarlier} onChange={event=>{setIncludeEarlier(event.target.checked);setExpanded(false);}}/>Include earlier months</label>
  {rows.length?<ol className="budget-history-list">{rows.map(renderRow)}</ol>:<p className="budget-history-empty">No activity {includeEarlier?'through':'in'} this month.</p>}
  {history.rows.length>3&&<button type="button" className="text-button" onClick={()=>setExpanded(!expanded)}>{expanded?'Show fewer':'Show all '+history.rows.length+' entries'}</button>}
  {history.cardContext.length>0&&<details className="budget-history-card-context"><summary>Related card activity ({history.cardContext.length})</summary><p>These amounts apply to the whole card. They can change cash available for repayment without adding category spending.</p><ol>{history.cardContext.map(row=><li key={row.entry.id}><div><time dateTime={row.date}>{row.date}</time><strong>{fmt(row.amount)}</strong></div><span>{row.from} → {row.to}</span><small>{row.kind==='allocation'?'Cash set aside changed':row.kind==='payment'?'Card payment':row.kind==='refund'?'Refund to the same card':'Card balance adjustment'}</small>{row.entry.note&&<p>{row.entry.note}</p>}</li>)}</ol></details>}
 </section>;
}
