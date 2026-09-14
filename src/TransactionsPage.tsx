import {useEffect,useId,useRef,useState} from 'react';
import {ListFilter,Plus,Search,SearchX,Upload,X} from 'lucide-react';
import Select from './Select';
import ScheduledTransactions,{transactionMatches} from './ScheduledTransactions';
import TransactionEditor from './TransactionEditor';
import TransactionRow from './TransactionRow';
import {transactionPresentation} from './transaction-presentation';
import {money,thisMonth,today} from './engine';
import type {Budget,Entry,Totals} from './engine';
import type {DialogState} from './Dialogs';
import {isCleared,setCleared} from './reconciliation';
import './transactions-page.css';

type Props={
 editingRef:{current:boolean};b:Budget;t:Totals;month:string;onCurrentMonth:()=>void;
 query:string;setQuery:(query:string)=>void;accountFilter:string;setAccountFilter:(id:string)=>void;
 open:(dialog:DialogState)=>void;commit:(budget:Budget,message:string)=>void;
 action:(fn:()=>void)=>void;closeDialog:()=>void;onPeople:()=>void;onEditingChange:(editing:boolean)=>void;
};

export default function TransactionsPage({editingRef,b,t,month,onCurrentMonth,query,setQuery,accountFilter,setAccountFilter,open,commit,action,closeDialog,onPeople,onEditingChange}:Props){
 const [clearedFilter,setClearedFilter]=useState(false);
 const [editing,setEditing]=useState<Entry|null>(null),[expanded,setExpanded]=useState('');
 const editFocus=useRef('');
 const search=useRef<HTMLInputElement>(null),status=useRef<HTMLButtonElement>(null),toolbar=useRef<HTMLDivElement>(null);
 const id=useId(),monthName=new Date(month+'-01T12:00:00').toLocaleDateString('en-US',{month:'long',year:'numeric'});
 useEffect(()=>{editingRef.current=!!editing;onEditingChange(!!editing);return()=>{editingRef.current=false;onEditingChange(false);};},[editing,editingRef,onEditingChange]);
 const cancelEdit=()=>{const entry=editing;setEditing(null);requestAnimationFrame(()=>(document.getElementById(editFocus.current||'edit-transaction-'+entry?.id)??search.current)?.focus({preventScroll:true}));};
 const toggleDetails=(entry:Entry)=>{if(editing)return;const closing=expanded===entry.id;setExpanded(closing?'':entry.id);if(closing)requestAnimationFrame(()=>document.getElementById('transaction-toggle-'+entry.id)?.focus({preventScroll:true}));};
 const rows=t.transactions.filter(e=>transactionMatches(b,e,query,accountFilter)&&(!clearedFilter||transactionPresentation(b,e,accountFilter).uncleared));
 const filtered=!!query.trim()||accountFilter!=='all'||clearedFilter;
 const hasDue=(b.schedules??[]).some(s=>s.nextDate<=today()&&transactionMatches(b,s.template,query,accountFilter));
 const fmt=(n:number)=>money(n,b.currency);
 const clearSearch=()=>{if(editing)return;setQuery('');search.current?.focus({preventScroll:true});};
 const clearFilters=()=>{if(editing)return;setQuery('');setAccountFilter('all');setClearedFilter(false);search.current?.focus({preventScroll:true});};

 const recorded=<section key="recorded" className="recorded-section" id={id+'-results'} aria-labelledby={id+'-recorded'}>
  <h2 className="recorded-heading" id={id+'-recorded'}>Recorded transactions</h2>
  {(rows.length>0||editing)?<>
   <p className="transaction-edit-hint">Choose a payee to edit. Manage shared purchases and repayments in People.</p>
   <div className="transaction-list" role="table" aria-label="Transactions">
    <div className="transaction-columns" role="row"><span role="columnheader">Date</span><span role="columnheader">Account</span><span role="columnheader">Payee / description</span><span role="columnheader">Category / transfer</span><span role="columnheader">Amount</span><span role="columnheader" aria-label="Cleared status">Cleared</span><span role="columnheader">Actions</span></div>
    {(editing&&!rows.some(e=>e.id===editing.id)?[editing,...rows]:rows).map(e=>{
  if(editing?.id===e.id)return <TransactionEditor key={e.id} entry={editing} b={b} commit={commit} onClose={cancelEdit} onRefund={()=>open({type:'refund',purchase:editing})}/>;
  return <TransactionRow key={e.id} b={b} entry={e} accountFilter={accountFilter} editing={!!editing} expanded={expanded===e.id}
   onToggle={()=>toggleDetails(e)} onEdit={controlId=>{if(editing)return;editFocus.current=controlId;setEditing(e);}} onRefund={()=>open({type:'refund',purchase:e})} onPeople={onPeople}
   onClear={accountId=>action(()=>commit({...b,entries:b.entries.map(entry=>entry.id===e.id?setCleared(entry,accountId,!isCleared(entry,accountId)):entry)},'Transaction status updated'))}
   onDelete={()=>open({type:'confirm',destructive:true,title:'Remove this transaction?',description:e.payee+' · '+fmt(e.amount)+'. Account balances and your budget will be recalculated. You can undo this change.',label:'Remove transaction',action:()=>{if(b.entries.some(entry=>entry.refundOf===e.id))throw new Error('Remove the linked refunds before removing this purchase.');commit({...b,entries:b.entries.filter(entry=>entry.id!==e.id)},'Transaction removed');closeDialog();}})}/>;
 })}
   </div>
   <div className="transaction-list-footer"><span>Transfers and card payments are excluded from spending.</span></div>
  </>:<div className="recorded-empty">
   <SearchX size={28} aria-hidden="true"/>
   <h3>{filtered?'No matching transactions':`No recorded transactions in ${monthName}`}</h3>
   <p>{filtered?'Change a search or filter, or clear them to see all recorded activity for this month.':'Add a transaction when it happens, or import a CSV from your bank.'}</p>
   <div className="transaction-empty-actions">
    {filtered?<button type="button" className="button primary" onClick={clearFilters}>Clear filters</button>:<button type="button" className="button primary" onClick={()=>open({type:'transaction'})}><Plus size={16}/>Add your first transaction</button>}
    {month!==thisMonth()&&<button type="button" className="button secondary" onClick={onCurrentMonth}>Go to current month</button>}
   </div>
  </div>}
 </section>;
 const scheduled=<ScheduledTransactions key="scheduled" b={b} query={query} accountFilter={accountFilter} editing={!!editing} open={open} commit={commit} action={action} closeDialog={closeDialog}/>;

 return <section className="transactions-panel transactions-dense">
  <div className="transactions-toolbar" ref={toolbar}>
   <div className="search-box">
    <Search size={18} aria-hidden="true"/>
    <input ref={search} id="workspace-search" aria-label="Search transactions" aria-controls={id+'-results'} placeholder="Search payee, account, category or note" value={query} disabled={!!editing} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'&&query){e.preventDefault();clearSearch();}}}/>
    {query&&<button type="button" className="icon-button" aria-label="Clear search" disabled={!!editing} onClick={clearSearch}><X size={16}/></button>}
   </div>
   <Select aria-label="Filter by account" value={accountFilter} disabled={!!editing} onChange={e=>setAccountFilter(e.target.value)}><option value="all">All accounts</option>{b.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select>
   <button ref={status} type="button" className={'button secondary '+(clearedFilter?'selected-button':'')} aria-pressed={clearedFilter} disabled={!!editing} onClick={()=>setClearedFilter(!clearedFilter)}><ListFilter size={16}/>{clearedFilter?'Uncleared':'All statuses'}</button>
   <button type="button" className="button secondary" disabled={!!editing} onClick={()=>open({type:'reconcile',accountId:accountFilter==='all'?undefined:accountFilter})}>Reconcile</button>
   <button type="button" className="button secondary" disabled={!!editing} onClick={()=>open({type:'import'})}><Upload size={16}/>Import CSV</button>
  </div>
  <div className="transaction-filter-state">
   <p role="status" aria-atomic="true">{rows.length}{filtered?' of '+t.transactions.length:''} recorded transaction{rows.length===1?'':'s'} in {monthName}.</p>
   {filtered&&<div className="active-transaction-filters" aria-label="Active transaction filters">
    {query.trim()&&<button type="button" disabled={!!editing} onClick={clearSearch} aria-label={'Clear search: '+query}><span>Search: {query}</span><X size={14} aria-hidden="true"/></button>}
    {accountFilter!=='all'&&<button type="button" disabled={!!editing} onClick={()=>{setAccountFilter('all');requestAnimationFrame(()=>toolbar.current?.querySelector<HTMLElement>('[aria-label="Filter by account"]')?.focus({preventScroll:true}));}} aria-label="Clear account filter"><span>{b.accounts.find(a=>a.id===accountFilter)?.name??'Account'}</span><X size={14} aria-hidden="true"/></button>}
    {clearedFilter&&<button type="button" disabled={!!editing} onClick={()=>{setClearedFilter(false);status.current?.focus({preventScroll:true});}} aria-label="Clear uncleared filter"><span>Uncleared</span><X size={14} aria-hidden="true"/></button>}
    <button type="button" className="clear-all-filters" disabled={!!editing} onClick={clearFilters}>Clear all</button>
   </div>}
  </div>
  {editing&&<p className="transaction-filter-help">Save or cancel the open edit to use these filters, import or reconcile.</p>}
  <div className="transaction-sections">{hasDue?[scheduled,recorded]:[recorded,scheduled]}</div>
 </section>;
}
