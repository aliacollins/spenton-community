import {ArrowLeftRight,ArrowUpRight,Check,ChevronDown,Circle,LockKeyhole,Minus,Pencil,RotateCcw,StickyNote,Trash2} from 'lucide-react';
import type {Budget,Entry} from './engine';
import {isSharedEntry,money} from './engine';
import {dateInputText,displayDate} from './dates';
import {isCleared} from './reconciliation';
import {CategoryIcon} from './ui';
import {transactionPresentation} from './transaction-presentation';

export default function TransactionRow({b,entry,accountFilter,editing,expanded,onToggle,onEdit,onClear,onDelete,onRefund,onPeople}:{
 b:Budget;entry:Entry;accountFilter:string;editing:boolean;expanded:boolean;
 onToggle:()=>void;onEdit:(controlId:string)=>void;onClear:(accountId:string)=>void;onDelete:()=>void;onRefund:()=>void;onPeople:()=>void;
}){
 const context=transactionPresentation(b,entry,accountFilter),fmt=(value:number)=>money(value,b.currency);
 const category=b.categories.find(value=>value.id===entry.categoryId),shared=isSharedEntry(entry),immutable=entry.kind==='adjustment';
 const badge=entry.kind==='expense'?(shared?'Shared':''):['income','transfer','payment'].includes(entry.kind)?'':context.kindLabel;
 const accountIds=[entry.accountId,entry.toAccountId].filter((id):id is string=>!!id);
 const categoryLabel=entry.kind==='income'?(context.source?.type==='investment'?'Outside your budget':'Available to plan'):context.kindLabel;
 return <>
  <div className={'transaction-row '+(expanded?'is-expanded':'')} role="row">
   <span className="transaction-date" role="cell"><time dateTime={entry.date}>{dateInputText(entry.date)}</time></span>
   <span className="transaction-account" role="cell" data-tooltip={context.accountName}>{context.accountName}</span>
   <span className="transaction-payee" role="cell">
    <button type="button" className="text-button" aria-label={shared?'Review '+entry.payee+' in People':immutable?'View '+entry.payee+' details':'Edit '+entry.payee+' transaction'} id={'edit-transaction-'+entry.id} disabled={editing} data-tooltip={entry.payee} onClick={event=>shared?onPeople():immutable?onToggle():onEdit(event.currentTarget.id)}><strong>{entry.payee||context.kindLabel}</strong>{shared?<ArrowUpRight size={12}/>:!immutable&&<Pencil size={12}/>}</button>
    {badge&&<span className="transaction-kind-chip" data-tooltip={badge}>{badge}</span>}
    {entry.note&&<span className="transaction-note-indicator" data-tooltip={entry.note} role="img" aria-label="Has a note"><StickyNote size={13} aria-hidden="true"/></span>}
   </span>
   <span role="cell" className="transaction-category-cell">
    {context.transfer?<span className="transaction-route" data-tooltip={context.relation}><ArrowLeftRight size={14} aria-hidden="true"/><span>{context.relation}</span></span>:entry.splits?<span className="transaction-category-label" data-tooltip={entry.splits.map(part=>(b.categories.find(value=>value.id===part.categoryId)?.name??'Category')+': '+fmt(part.amount)).join(', ')}>Split · {entry.splits.length} categories</span>:category?<span className="transaction-category" data-tooltip={category.name}><CategoryIcon category={category} size={12}/><span>{category.name}</span></span>:<span className="transaction-category-label" data-tooltip={categoryLabel}>{categoryLabel}</span>}
   </span>
   <span className="transaction-amount-cell" role="cell"><strong className="transaction-amount" data-movement={context.movement}>{context.sign}{fmt(entry.amount)}</strong></span>
   <span className="transaction-status-cell" role="cell">
    {entry.accountId?<button type="button" className={'clear-button '+((context.reviewClearing?context.allCleared:context.cleared)?'cleared':'')+(context.reviewClearing&&context.mixedClearing?' mixed':'')} disabled={editing} data-tooltip={context.reviewClearing?'Review clearing for both accounts':context.cleared?'Cleared in '+context.accountName:'Not cleared in '+context.accountName} aria-label={context.reviewClearing?'Review clearing for '+entry.payee:(context.cleared?'Mark uncleared: ':'Mark cleared: ')+entry.payee} aria-pressed={context.reviewClearing?undefined:context.cleared} aria-expanded={context.reviewClearing?expanded:undefined} aria-controls={context.reviewClearing?'transaction-details-'+entry.id:undefined} onClick={()=>context.reviewClearing?onToggle():context.accountId&&onClear(context.accountId)}>{context.reviewClearing&&context.mixedClearing?<Minus size={14}/>:((context.reviewClearing?context.allCleared:context.cleared)?<Check size={13}/>:<Circle size={14}/>)}</button>:<span className="transaction-no-cash">No cash</span>}
   </span>
   <span className="transaction-row-actions" role="cell">
    <button id={'transaction-toggle-'+entry.id} type="button" className="transaction-details-toggle" disabled={editing} aria-label={(expanded?'Hide':'Show')+' details for '+entry.payee} aria-expanded={expanded} aria-controls={'transaction-details-'+entry.id} onClick={onToggle}><span>Details</span><ChevronDown size={14}/></button>
    <button type="button" className="icon-button delete-transaction" disabled={shared||editing} data-tooltip={shared?'Manage this shared expense in People':'Remove transaction'} aria-label={'Delete '+entry.payee+' transaction'} onClick={event=>{event.currentTarget.focus({preventScroll:true});onDelete();}}>{shared?<LockKeyhole size={13}/>:<Trash2 size={14}/>}</button>
   </span>
  </div>
  <div className="transaction-detail-row" hidden={!expanded} role="row" id={'transaction-details-'+entry.id} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onToggle();}}}><div role="cell" aria-colspan={7}>{expanded&&<>
   <header><div><span>{context.kindLabel}</span><h3>{entry.payee||context.kindLabel}</h3></div><button type="button" className="text-button" disabled={editing} onClick={onToggle}>Close details<ChevronDown size={14}/></button></header>
   <dl className="transaction-detail-facts">
    <div><dt>Date</dt><dd>{displayDate(entry.date)}</dd></div>
    {context.transfer?<><div><dt>From account</dt><dd>{context.source?.name??'Account unavailable'}</dd></div><div><dt>To account</dt><dd>{context.destination?.name??'Account unavailable'}</dd></div></>:<div><dt>Account</dt><dd>{context.accountName}</dd></div>}
    <div><dt>{context.transfer?'Transfer amount':entry.accountId?'Account amount':'Entry amount'}</dt><dd>{fmt(entry.amount)}</dd></div>
    {!context.transfer&&!entry.splits&&category&&<div><dt>Category</dt><dd>{category.name}</dd></div>}
    {entry.sharedAmount!==undefined&&<><div><dt>{entry.kind==='shared_refund'?'Your refund':'Your spending'}</dt><dd>{fmt(entry.amount-entry.sharedAmount)}</dd></div><div><dt>Other people’s shares</dt><dd>{fmt(entry.sharedAmount)}</dd></div></>}
   </dl>
   {entry.splits&&<section className="transaction-detail-splits" aria-label="Category split">{entry.splits.map(part=><div key={part.categoryId}><span>{b.categories.find(value=>value.id===part.categoryId)?.name??'Category unavailable'}</span><strong>{fmt(part.amount)}</strong></div>)}</section>}
   {entry.note&&<p className="transaction-detail-note"><strong>{immutable?'Reason':'Note'}</strong>{entry.note}</p>}
   {context.transfer&&<div className="transaction-clearing-details"><p>Each account clears separately. This {entry.kind==='payment'?'card payment':'transfer'} does not count as spending.</p>{accountIds.map(accountId=>{
    const cleared=isCleared(entry,accountId),name=b.accounts.find(account=>account.id===accountId)?.name??'Account unavailable';
    return <button type="button" key={accountId} className="button secondary" disabled={editing} aria-pressed={cleared} aria-label={'Mark '+(cleared?'uncleared':'cleared')+' in '+name} onClick={()=>onClear(accountId)}>{cleared?<Check size={14}/>:<Circle size={14}/>}<span>{name}</span><small>{cleared?'Cleared':'Not cleared'}</small></button>;
   })}</div>}
   {shared?<div className="transaction-detail-actions"><p>Manage shares and repayments in People.</p><button type="button" className="button secondary" disabled={editing} onClick={onPeople}>Open People<ArrowUpRight size={14}/></button></div>:!immutable&&<div className="transaction-detail-actions"><button type="button" className="text-button" disabled={editing} id={'transaction-detail-edit-'+entry.id} onClick={event=>onEdit(event.currentTarget.id)}><Pencil size={14}/>Edit transaction</button>{entry.kind==='expense'&&<button type="button" className="button secondary" disabled={editing} onClick={event=>{event.currentTarget.focus({preventScroll:true});onRefund();}}><RotateCcw size={14}/>Record linked refund</button>}</div>}
  </>}</div></div>
 </>;
}
