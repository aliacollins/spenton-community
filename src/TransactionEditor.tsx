import Select from './Select';
import AmountInput from './AmountInput';
import DatePicker from './DatePicker';
import { useState } from 'react';
import { Check, X, Split, ArrowUpRight, ArrowDownLeft, ArrowLeftRight, CreditCard } from 'lucide-react';
import { canUseAccountForEntry, cents, money, today, validateBudget } from './engine';
import type { Budget, Entry } from './engine';
import { savedPayees } from './payees';
import PayeePicker from './PayeePicker';
import CategoryPicker from './CategoryPicker';
import pipIllustration from './brand/pip.svg';

export default function TransactionEditor({entry,b,commit,onClose,onRefund}:{entry:Entry;b:Budget;commit:(b:Budget,message:string)=>void;onClose:()=>void;onRefund:()=>void}){
 const [original]=useState(()=>JSON.stringify(entry));
 const [draft,setDraft]=useState(entry);
 const [amount,setAmount]=useState((entry.amount/100).toFixed(2));
 const [split,setSplit]=useState(!!entry.splits);
 const [parts,setParts]=useState(entry.splits?.map(p=>({...p,amount:(p.amount/100).toFixed(2)}))??[{categoryId:entry.categoryId??b.categories[0]?.id??'',amount:(entry.amount/100).toFixed(2)},{categoryId:b.categories.find(c=>c.id!==entry.categoryId)?.id??b.categories[0]?.id??'',amount:''}]);
 const [error,setError]=useState('');
 const categorized=['expense','refund'].includes(entry.kind),transfer=['payment','transfer'].includes(entry.kind);
 const accounts=b.accounts.filter(a=>canUseAccountForEntry(a,entry.kind));
 const categories=entry.kind==='refund'?b.categories.filter(c=>{const purchase=b.entries.find(p=>p.id===entry.refundOf);return purchase?.categoryId===c.id||purchase?.splits?.some(p=>p.categoryId===c.id);}):b.categories;
 const positive=(value:string)=>{const n=cents(value);if(n<=0)throw new Error('Enter an amount greater than zero.');return n;};
 const update=(values:Partial<Entry>)=>setDraft(d=>({...d,...values}));
 function save(){
  try{
   if(JSON.stringify(b.entries.find(e=>e.id===entry.id))!==original)throw new Error('This transaction changed elsewhere. Your edits are still here. Cancel to load the latest version before editing again.');
   if(draft.date>today())throw new Error('Use a date on or before today for a recorded transaction.');
   const next:Entry={...draft,payee:draft.payee.trim(),amount:positive(amount),...(categorized?split?{categoryId:undefined,splits:parts.map(p=>({...p,amount:positive(p.amount)}))}:{categoryId:draft.categoryId??categories[0]?.id,splits:undefined}:{})};
   if(!next.payee)throw new Error('Enter a payee or description.');
   commit(validateBudget({...b,entries:b.entries.map(e=>e.id===entry.id?next:e)}),'Transaction updated');onClose();
  }catch(cause){setError(cause instanceof Error?cause.message:'Could not save this transaction.');}
 }
 let difference:number|null=null;try{difference=cents(amount)-parts.reduce((sum,p)=>sum+cents(p.amount||'0'),0);}catch{/* Keep incomplete amounts editable. */}
 const kindLabel=entry.kind==='refund'?'Linked refund':entry.kind==='payment'?'Card payment':entry.kind[0].toUpperCase()+entry.kind.slice(1);
 const KindIcon=entry.kind==='income'||entry.kind==='refund'?ArrowDownLeft:entry.kind==='transfer'?ArrowLeftRight:entry.kind==='payment'?CreditCard:ArrowUpRight;
 return <div className={'transaction-inline-row inline-'+entry.kind} role="row"><div role="cell" aria-colspan={7}>
  <form aria-label={'Edit '+entry.payee+' inline'} onChange={()=>setError('')} onSubmit={e=>{e.preventDefault();save();}} onKeyDown={e=>{if(e.key==='Escape'&&!e.nativeEvent.isComposing){e.preventDefault();onClose();}}}>
   <div className="transaction-edit-heading"><span className="inline-kind-icon"><KindIcon size={21}/></span><div><strong>Edit transaction</strong><span>Update the details, then save.</span></div><img src={pipIllustration} alt="" aria-hidden="true"/></div>
   <div className="transaction-edit-body">
   <div className="transaction-edit-layout">
    <div className="transaction-edit-amount"><span className="inline-kind-label">{kindLabel}</span><label>Amount<div className="inline-amount-input"><span>{b.currency}</span><AmountInput aria-label="Transaction amount" inputMode="decimal" required value={amount} onChange={e=>setAmount(e.target.value)}/></div></label><span className="inline-entry-status"><Check size={13}/>{entry.cleared?'Cleared in your account':'Not yet cleared'}</span></div>
    <div className="transaction-edit-main">
   <div className="transaction-edit-fields">
    <label>{entry.kind==='income'?'Received from':transfer?'Description':'Who did you pay?'}<PayeePicker label="Payee" value={draft.payee} payees={savedPayees(b,entry.kind)} onChange={payee=>update({payee})} autoFocus/></label>
    <label>{transfer?'To account':'Category'}{categorized&&!split?<CategoryPicker label="Transaction category" value={draft.categoryId??categories[0]?.id??''} categories={categories} onChange={categoryId=>update({categoryId})}/>:transfer?<Select aria-label={entry.kind==='payment'?'Payment destination':'Transfer destination'} value={draft.toAccountId??''} required onChange={e=>update({toAccountId:e.target.value})}>{b.accounts.filter(a=>entry.kind==='payment'?a.type==='credit':a.type!=='credit'&&a.id!==draft.accountId).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select>:<span className="transaction-edit-static">{split?parts.length+' categories':b.accounts.find(a=>a.id===draft.accountId)?.type==='investment'?'Outside your budget':'Available to plan'}</span>}</label>
    <label>{transfer?'From account':'Account'}<Select aria-label="Transaction account" value={draft.accountId} disabled={entry.kind==='refund'} required onChange={e=>update({accountId:e.target.value})}>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select></label>
    <label>Date<DatePicker aria-label="Transaction date" required max={today()} value={draft.date} onChange={date=>update({date})}/></label>
   </div>
   <div className="transaction-edit-details"><label className="transaction-edit-note">Note (optional)<input aria-label="Transaction note" placeholder="Add a note…" maxLength={500} value={draft.note} onChange={e=>update({note:e.target.value})}/></label>{categorized&&<label className="check-label"><input type="checkbox" checked={split} onChange={e=>setSplit(e.target.checked)}/><span>Split across categories</span></label>}</div>
    </div>
   </div>
   {categorized&&split&&<section className="transaction-edit-splits"><header><div><Split size={18}/><strong>Split this transaction</strong></div><span>Enter each category’s amount.</span></header>{parts.map((part,i)=><div className="transaction-split-part" key={i}><span className="transaction-split-number">{String(i+1).padStart(2,'0')}</span><label>Category {i+1}<CategoryPicker label={'Split category '+(i+1)} value={part.categoryId} categories={categories} onChange={categoryId=>setParts(parts.map((p,n)=>n===i?{...p,categoryId}:p))}/></label><label>Amount<AmountInput aria-label={'Split amount '+(i+1)} inputMode="decimal" required value={part.amount} onChange={e=>setParts(parts.map((p,n)=>n===i?{...p,amount:e.target.value}:p))}/></label>{parts.length>2&&<button className="icon-button" type="button" aria-label={'Remove split '+(i+1)} onClick={()=>setParts(parts.filter((_,n)=>n!==i))}><X size={16}/></button>}</div>)}<div><button className="text-button" type="button" onClick={()=>setParts([...parts,{categoryId:categories[0]?.id??'',amount:''}])}>+ Add split</button><span>{difference===0&&parts.every(p=>{try{return cents(p.amount)>0;}catch{return false;}})?'All amounts match':difference===null?'Check split amounts':difference===0?'Enter an amount for each category':difference<0?money(-difference,b.currency)+' over the total':money(difference,b.currency)+' left to split'}</span></div></section>}
   </div>
   {error&&<p className="transaction-edit-error" role="alert">{error}</p>}
   <div className="transaction-edit-actions">{entry.kind==='expense'&&<button type="button" className="text-button" onClick={onRefund}>Record linked refund</button>}<span className="transaction-edit-shortcut">Enter to save · Esc to cancel</span><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" type="submit" aria-label="Save transaction"><Check size={16}/>Save changes</button></div>
  </form>
 </div></div>;
}


