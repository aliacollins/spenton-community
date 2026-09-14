import {useId,useRef,useState} from 'react';
import {ArrowLeftRight,CalendarClock,ChevronDown,Pencil,Repeat2,SkipForward,StickyNote,Trash2} from 'lucide-react';
import type {Budget,Entry,Schedule} from './engine';
import type {DialogState} from './Dialogs';
import {money,today} from './engine';
import {dateInputText} from './dates';
import {assertScheduleCurrent,postOccurrence,skipOccurrence} from './recurring';
import {CategoryIcon} from './ui';
import './scheduled-transactions.css';
import {transactionKindLabel,transactionPresentation} from './transaction-presentation';

export function transactionMatches(b:Budget,entry:Entry,query:string,account:string):boolean {
 return (account==='all'||entry.accountId===account||entry.toAccountId===account)&&[entry.payee,entry.note,transactionKindLabel(entry),b.accounts.find(value=>value.id===entry.accountId)?.name??'',b.accounts.find(value=>value.id===entry.toAccountId)?.name??'',b.categories.find(c=>c.id===entry.categoryId)?.name??'',...(entry.splits??[]).map(s=>b.categories.find(c=>c.id===s.categoryId)?.name??'')].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

export default function ScheduledTransactions({b,query,accountFilter,editing,open,commit,action,closeDialog}:{b:Budget;query:string;accountFilter:string;editing:boolean;open:(dialog:DialogState)=>void;commit:(b:Budget,message:string)=>void;action:(fn:()=>void)=>void;closeDialog:()=>void}){
 const [expanded,setExpanded]=useState(true),id=useId(),latest=useRef(b);latest.current=b;
 const schedules=b.schedules??[],rows=schedules.filter(s=>transactionMatches(b,s.template,query,accountFilter)).sort((a,c)=>a.nextDate.localeCompare(c.nextDate)||a.template.payee.localeCompare(c.template.payee));
 const due=rows.filter(s=>s.nextDate<=today()).length,fmt=(amount:number)=>money(amount,b.currency);
 function change(schedule:Schedule,operation:'record'|'skip'){
  action(()=>{const budget=latest.current;assertScheduleCurrent(budget,schedule);commit(operation==='record'?postOccurrence(budget,schedule.id):skipOccurrence(budget,schedule.id),operation==='record'?'Transaction recorded as uncleared':schedule.frequency==='once'?'Scheduled transaction skipped':'Next occurrence skipped');});
 }
 function remove(schedule:Schedule){
  open({type:'confirm',destructive:true,title:'Remove this schedule?',description:schedule.template.payee+' · '+fmt(schedule.template.amount)+'. '+(schedule.frequency==='once'?'This removes the scheduled transaction.':'This removes all future occurrences.')+' Recorded transactions are kept. You can undo this change.',label:'Remove schedule',action:()=>{const budget=latest.current;assertScheduleCurrent(budget,schedule);commit({...budget,schedules:budget.schedules!.filter(s=>s.id!==schedule.id)},'Schedule removed. Recorded transactions are kept.');closeDialog();}});
 }
 if(!schedules.length||!rows.length)return null;
 return <section className="scheduled-transactions" aria-labelledby={id+'-heading'}>
  <header className="scheduled-heading"><h2 id={id+'-heading'}><button type="button" aria-label="Scheduled transactions" aria-expanded={expanded} aria-controls={id+'-rows'} onClick={()=>setExpanded(!expanded)}><ChevronDown size={16} className={expanded?'':'is-collapsed'}/><CalendarClock size={18}/><span>Scheduled transactions</span><span className="scheduled-count">{rows.length}</span></button></h2><span className="scheduled-scope">All dates</span>{due>0&&<span className="scheduled-due-count">{due} ready to record</span>}</header>
  {expanded&&<div id={id+'-rows'}><p className="scheduled-description">Balances change only when you record a transaction.</p>
   <div className="scheduled-table" role="table" aria-label="Scheduled transactions"><div className="transaction-columns scheduled-columns" role="row"><span role="columnheader">Next date</span><span role="columnheader">Account</span><span role="columnheader">Payee / repeat</span><span role="columnheader">Category / transfer</span><span role="columnheader">Amount</span><span role="columnheader">When</span><span role="columnheader">Actions</span></div>
    {rows.map(schedule=>{const entry=schedule.template,category=b.categories.find(value=>value.id===entry.categoryId),context=transactionPresentation(b,entry,accountFilter),income=entry.kind==='income',status=schedule.nextDate<today()?'Overdue':schedule.nextDate===today()?'Today':'Upcoming';
     return <div className="transaction-row scheduled-row" role="row" key={schedule.id} aria-label={'Scheduled '+entry.payee}>
      <span className="scheduled-date transaction-date" role="cell"><time dateTime={schedule.nextDate}>{dateInputText(schedule.nextDate)}</time></span>
      <span className="scheduled-account transaction-account" role="cell" data-tooltip={context.accountName}>{context.accountName}</span>
      <span className="scheduled-payee" role="cell"><button type="button" className="text-button" disabled={editing} aria-label={'Edit scheduled '+entry.payee} data-tooltip={entry.payee} onClick={event=>{event.currentTarget.focus({preventScroll:true});open({type:'transaction',schedule});}}><strong>{entry.payee}</strong><Pencil size={12}/></button><span className="scheduled-meta">{schedule.frequency==='once'?<CalendarClock size={12}/>:<Repeat2 size={12}/>}<span>{schedule.frequency==='once'?'One-time':schedule.frequency.charAt(0).toUpperCase()+schedule.frequency.slice(1)}</span></span>{entry.note&&<span className="transaction-note-indicator" data-tooltip={entry.note} role="img" aria-label="Has a note"><StickyNote size={13}/></span>}</span>
      <span role="cell" className="scheduled-category transaction-category-cell">{context.transfer?<span className="transaction-route" data-tooltip={context.relation}><ArrowLeftRight size={14}/><span>{context.relation}</span></span>:entry.splits?<span className="transaction-category-label" data-tooltip={entry.splits.map(part=>(b.categories.find(value=>value.id===part.categoryId)?.name??'Category')+': '+fmt(part.amount)).join(', ')}>Split · {entry.splits.length} categories</span>:category?<span className="transaction-category" data-tooltip={category.name}><CategoryIcon category={category} size={12}/><span>{category.name}</span></span>:<span className="transaction-category-label">{income?(context.source?.type==='investment'?'Outside your budget':'Income'):context.kindLabel}</span>}</span>
      <span className="scheduled-money transaction-amount-cell" role="cell"><strong className="transaction-amount" data-movement={context.movement}>{context.sign}{fmt(entry.amount)}</strong></span>
      <span className="scheduled-status-cell" role="cell"><span className={'scheduled-status status-'+status.toLowerCase()}>{status}</span></span>
      <span className="scheduled-actions" role="cell"><span data-tooltip={schedule.nextDate>today()?'If this happened early, edit its date before recording it.':'Record this transaction after it happens.'}><button type="button" className="scheduled-record" disabled={editing||schedule.nextDate>today()} aria-label={'Record '+entry.payee} onClick={()=>change(schedule,'record')}>Record</button></span><button type="button" className="icon-button" disabled={editing} data-tooltip={schedule.frequency==='once'?'Skip this scheduled transaction':'Skip the next occurrence'} aria-label={'Skip scheduled '+entry.payee} onClick={()=>change(schedule,'skip')}><SkipForward size={15}/></button><button type="button" className="icon-button" disabled={editing} data-tooltip="Remove schedule" aria-label={'Remove schedule for '+entry.payee} onClick={event=>{event.currentTarget.focus({preventScroll:true});remove(schedule);}}><Trash2 size={15}/></button></span>
     </div>;
    })}
   </div>
  </div>}
 </section>;
}
