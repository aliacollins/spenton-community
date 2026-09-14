import {useMemo,useRef,useState} from 'react';
import {ArrowUpRight,CalendarClock,EyeOff,ListPlus,Pencil,Plus,Repeat2,Search,Wallet,X} from 'lucide-react';
import type {Budget,Schedule} from './engine';
import {canUseAccountForEntry,money,today} from './engine';
import type {DialogState} from './Dialogs';
import {canTrackSubscription,subscriptionCosts,trackedSubscriptions,trackSubscriptions} from './subscriptions';
import {assertScheduleCurrent,postOccurrence} from './recurring';
import {CategoryIcon} from './ui';
import Select from './Select';
import {displayDate} from './dates';
import './subscriptions.css';

type Props={b:Budget;busy:boolean;readOnly:boolean;available:boolean;open:(dialog:DialogState)=>void;commit:(budget:Budget,message:string)=>void;action:(fn:()=>void)=>void};
const frequencyLabel={weekly:'Weekly',monthly:'Monthly',yearly:'Yearly',once:'One-time'};
export default function SubscriptionsPage({b,busy,readOnly,available,open,commit,action}:Props){
 const [query,setQuery]=useState(''),[frequency,setFrequency]=useState('all');
 const latest=useRef(b);latest.current=b;
 const subscriptions=useMemo(()=>trackedSubscriptions(b),[b]),cost=useMemo(()=>subscriptionCosts(subscriptions),[subscriptions]);
 const fmt=(amount:number|null)=>amount===null?'Total too large':money(amount,b.currency);
 const existing=(b.schedules??[]).filter(s=>canTrackSubscription(s)&&!s.subscription).length;
 const canAdd=b.accounts.some(a=>canUseAccountForEntry(a,'expense'))&&b.categories.length>0;
 const rows=subscriptions.filter(s=>(frequency==='all'||s.frequency===frequency)&&[
  s.template.payee,s.template.note,b.accounts.find(a=>a.id===s.template.accountId)?.name,
  b.categories.find(c=>c.id===s.template.categoryId)?.name,...(s.template.splits??[]).map(p=>b.categories.find(c=>c.id===p.categoryId)?.name),
 ].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 const next=subscriptions[0],ready=subscriptions.filter(s=>s.nextDate<=today()).length;
 function record(schedule:Schedule){action(()=>{assertScheduleCurrent(latest.current,schedule);commit(postOccurrence(latest.current,schedule.id),'Subscription payment recorded as uncleared.');});}
 function stop(schedule:Schedule){action(()=>commit(trackSubscriptions(latest.current,[schedule],false),'Tracking stopped. The scheduled payment remains in Transactions.'));}
 return <section className="subscriptions-page" aria-label="Your subscriptions">
  {!available&&<div className="hint" role="status"><p>Subscriptions are temporarily unavailable. Your scheduled transactions are still available in Transactions.</p></div>}
  <div className="subscription-summary" aria-label="Subscription cost summary">
   <div><span>Monthly equivalent</span><strong>{fmt(cost.monthly)}</strong><small>Across {subscriptions.length} tracked {subscriptions.length===1?'subscription':'subscriptions'}</small></div>
   <div><span>Yearly equivalent</span><strong>{fmt(cost.annual)}</strong><small>At the amounts currently recorded</small></div>
   <div className="subscription-next"><span><CalendarClock size={15}/>{ready?'Ready to record':'Next payment'}</span><strong>{ready?`${ready} ${ready===1?'payment':'payments'}`:next?displayDate(next.nextDate):'None added'}</strong><small>{next?ready?'Check that payment happened before recording it.':next.template.payee||'Recurring expense':'Add a subscription to see its next date.'}</small></div>
  </div>
  <p className="subscription-estimate-note">Estimates use 12 monthly or 52 weekly payments per year. Actual payment dates can differ. Scheduled payments do not reduce your budget balances.</p>
  <div className="subscription-toolbar">
   <div className="subscription-search"><Search size={17}/><input aria-label="Search subscriptions" placeholder="Find a subscription, account or category" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button type="button" className="icon-button" aria-label="Clear subscription search" onClick={()=>setQuery('')}><X size={15}/></button>}</div>
   <Select aria-label="Filter subscriptions by frequency" value={frequency} onChange={e=>setFrequency(e.target.value)}><option value="all">All frequencies</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></Select>
   {existing>0&&<button type="button" className="button secondary" disabled={busy||readOnly} onClick={()=>open({type:'trackSubscriptions'})}><ListPlus size={16}/>Track existing <span>({existing})</span></button>}
  </div>
  {subscriptions.length>0?<div className="subscription-list" role="table" aria-label="Tracked subscriptions">
   <div className="subscription-columns" role="row"><span role="columnheader">Subscription</span><span role="columnheader">Payment</span><span role="columnheader">Next date</span><span role="columnheader">Account</span><span role="columnheader">Actions</span></div>
   {rows.map(schedule=>{
    const entry=schedule.template,category=b.categories.find(c=>c.id===entry.categoryId),due=schedule.nextDate<=today();
    return <div className="subscription-row" role="row" aria-label={'Subscription '+entry.payee} key={schedule.id}>
     <div className="subscription-identity" role="cell">{category?<CategoryIcon category={category} size={20}/>:<span className="subscription-symbol"><Repeat2 size={20}/></span>}<div><strong>{entry.payee||'Unnamed subscription'}</strong><small>{entry.splits?`${entry.splits.length} categories`:category?.name}</small>{entry.note&&<small className="subscription-note">{entry.note}</small>}</div></div>
     <div className="subscription-price" role="cell"><strong>{money(entry.amount,b.currency)}</strong><small>{frequencyLabel[schedule.frequency]}</small></div>
     <div className="subscription-date" role="cell"><time dateTime={schedule.nextDate}>{displayDate(schedule.nextDate)}</time>{due&&<small className="subscription-due">Ready to record</small>}</div>
     <div className="subscription-account" role="cell"><Wallet size={14}/><span>{b.accounts.find(a=>a.id===entry.accountId)?.name}</span></div>
     <div className="subscription-actions" role="cell">
      <button type="button" className="button secondary" aria-label={'Edit subscription '+entry.payee} disabled={busy||readOnly} onClick={()=>open({type:'transaction',schedule})}><Pencil size={14}/>Edit</button>
      {due&&<button type="button" className="button primary" aria-label={'Record payment for '+entry.payee} disabled={busy||readOnly} onClick={()=>record(schedule)}>Record payment<ArrowUpRight size={14}/></button>}
      <button type="button" className="icon-button" aria-label={'Stop tracking '+entry.payee} data-tooltip="Stop tracking here. Keep the schedule in Transactions." disabled={busy||readOnly} onClick={()=>stop(schedule)}><EyeOff size={17}/></button>
     </div>
    </div>;
   })}
   {!rows.length&&<div className="subscription-no-results"><p>No subscriptions match these filters.</p><button type="button" className="text-button" onClick={()=>{setQuery('');setFrequency('all');}}>Clear filters</button></div>}
  </div>:<div className="subscriptions-empty">
   <span className="subscriptions-empty-icon"><Repeat2 size={29}/></span><h2>Your recurring payments, together.</h2><p>Add subscriptions such as streaming, phone plans or software. You can also track recurring expenses already in Transactions.</p>
   <div className="button-row">{canAdd?<button type="button" className="button primary" disabled={busy||readOnly} onClick={()=>open({type:'subscription'})}><Plus size={17}/>Add subscription</button>:<>{!b.accounts.some(a=>canUseAccountForEntry(a,'expense'))&&<button type="button" className="button secondary" disabled={busy||readOnly} onClick={()=>open({type:'account'})}>Add an account</button>}{!b.categories.length&&<button type="button" className="button secondary" disabled={busy||readOnly} onClick={()=>open({type:'category'})}>Add a category</button>}</>}</div>
   {!canAdd&&<small>Add an account and category before adding a subscription.</small>}
  </div>}
  {subscriptions.length>0&&<p className="subscription-footer">{rows.length} of {subscriptions.length} subscriptions shown. Stop tracking keeps the schedule in Transactions. To cancel a service, contact its provider.</p>}
 </section>;
}
