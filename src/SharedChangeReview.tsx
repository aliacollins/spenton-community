import {useEffect,useState} from 'react';
import LoadingState from './LoadingState';
import {CheckCircle2,Clock3,ArrowRight,ArrowLeftRight,MoreHorizontal,Check} from 'lucide-react';
import {api} from './cloud';
import type {CloudBudget} from './cloud';
import {cents,money,today} from './engine';
import {Field} from './ui';
import DatePicker from './DatePicker';
import Select from './Select';
import type {Expense,Settlement} from './SharedExpenses';
import type {GroupDetail,GroupPair,SharedChange} from './group-types';
import type {useSharedRequest} from './useSharedRequest';
import {useSharingFormDraft} from './sharing-drafts';

type Request=ReturnType<typeof useSharedRequest>;
export type ChangeDraft={kind:'correct'|'refund'|'reverse_payment';expense:Expense;settlement?:Settlement}|{kind:'offset';group:GroupDetail;pair:GroupPair}|{kind:'reverse_offset';change:SharedChange};

export function changeDraftKey(draft:ChangeDraft){return 'change-'+draft.kind+'-'+(draft.kind==='reverse_payment'?draft.settlement?.id:draft.kind==='offset'?draft.group.id+':'+draft.pair.memberId:draft.kind==='reverse_offset'?draft.change.id:draft.expense.id);}

export function SharedChangeComposer({draft,snapshot,request,onCreated,onCancel}:{draft:ChangeDraft;snapshot:CloudBudget;request:Request;onCreated:(change:SharedChange)=>void;onCancel:()=>void}){
 const e='expense' in draft?draft.expense:null;
 const [merchant,setMerchant]=useState(e?.merchant??''),[amount,setAmount]=useState(draft.kind==='correct'?String((e?.total??0)/100):draft.kind==='offset'?String(draft.pair.offsettable/100):''),[date,setDate]=useState(draft.kind==='correct'?e?.date??today():today()),[category,setCategory]=useState(snapshot.budget.entries.find(x=>x.id===e?.entryId)?.categoryId??snapshot.budget.categories[0]?.id??''),[reason,setReason]=useState(draft.kind==='offset'?'Offset our shared bills.':'');
 const [shares,setShares]=useState(e?.shares.filter(s=>!['cancelled','refunded'].includes(s.state)).map(s=>({id:s.id,name:s.name||s.email,amount:String(s.amount/100)}))??[]);
 const savedDraft=useSharingFormDraft(request.scope,changeDraftKey(draft),snapshot.revision,{merchant,amount,date,category,reason,shares:JSON.stringify(shares.map(s=>({id:s.id,amount:s.amount})))},saved=>{setMerchant(saved.merchant??merchant);setAmount(saved.amount??amount);setDate(saved.date??date);setCategory(snapshot.budget.categories.some(c=>c.id===saved.category)?saved.category:category);setReason(saved.reason??'');try{const rows=JSON.parse(saved.shares??'[]');if(Array.isArray(rows))setShares(current=>current.map(s=>{const old=rows.find(r=>r.id===s.id);return {...s,amount:typeof old?.amount==='string'?old.amount:s.amount};}));}catch{/* Keep the current bill's shares. */}},!!reason);
 const cancel=()=>{savedDraft.clear();onCancel();};
 function submit(){
  try{
   const body:Record<string,unknown>={kind:draft.kind,reason,expectedRevision:snapshot.revision,confirmReview:true};
   if(draft.kind==='correct')Object.assign(body,{expenseId:e!.id,expectedExpenseRevision:e!.expenseRevision,total:cents(amount),merchant,date,categoryId:category,shares:shares.map(s=>({id:s.id,amount:cents(s.amount)}))});
   if(draft.kind==='refund')Object.assign(body,{expenseId:e!.id,expectedExpenseRevision:e!.expenseRevision,amount:cents(amount),date});
   if(draft.kind==='reverse_payment')body.settlementId=draft.settlement!.id;
   if(draft.kind==='reverse_offset')body.changeId=draft.change.id;
   if(draft.kind==='offset')Object.assign(body,{groupId:draft.group.id,expectedGroupRevision:draft.group.revision,otherMemberId:draft.pair.memberId,amount:cents(amount),date});
   if(['correct','refund','offset'].includes(draft.kind)&&Number(body.amount??body.total)<=0)throw new Error('Enter an amount greater than zero.');
   if(draft.kind==='refund'&&Number(body.amount)>e!.total-(e!.refunded??0))throw new Error('The refund must fit within the unrefunded bill total.');
   if(draft.kind==='offset'&&Number(body.amount)>draft.pair.offsettable)throw new Error('The offset must fit within both unpaid balances.');
   if(draft.kind==='correct'){const parts=body.shares as {amount:number}[];if(parts.some(p=>p.amount<=0)||parts.reduce((n,p)=>n+p.amount,0)>Number(body.total))throw new Error('Each share must be positive and fit within the bill total.');}
   request.perform<{change:SharedChange}>('/shared-changes',body,value=>{savedDraft.clear();onCreated(value.change);});
  }catch(error){request.setError(error instanceof Error?error.message:'Check the change.');}
 }
 return <form className="group-form" onSubmit={event=>{event.preventDefault();submit();}}>
  {savedDraft.notice}<fieldset disabled={request.busy||!!request.pending||savedDraft.needsReview}>
   <p>{draft.kind==='offset'?'Match the bills you owe each other. No money moves.':draft.kind==='refund'?'Record a merchant refund and review each person’s amount.':draft.kind==='correct'?'Update the bill, then review the changes.':draft.kind==='reverse_offset'?'Restore the amounts this offset cleared.':'Remove an incorrect repayment record. No money is sent.'}</p>
   {e&&<div className="group-bill-title"><strong>{e.merchant}</strong><span>{money(e.total,e.currency)} · {e.date}</span></div>}
   {draft.kind==='offset'&&<div className="group-offset-lines">{draft.pair.lines.filter(l=>l.amount>0).map(line=><div key={line.shareId}><span>{line.merchant}<small>{line.direction==='incoming'?`${draft.pair.name} owes you`:`You owe ${draft.pair.name}`}</small></span><strong>{money(line.amount,draft.group.currency)}</strong></div>)}</div>}
   {draft.kind==='correct'&&<Field label="Merchant"><input required maxLength={160} value={merchant} onChange={e=>setMerchant(e.target.value)}/></Field>}
   {['correct','refund','offset'].includes(draft.kind)&&<Field label={draft.kind==='correct'?'Corrected bill total':draft.kind==='refund'?'Refund received':'Amount to offset'}><input required inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></Field>}
   {['correct','refund','offset'].includes(draft.kind)&&<Field label={draft.kind==='correct'?'Purchase date':draft.kind==='refund'?'Refund date':'Offset date'}><DatePicker required value={date} onChange={setDate} max={today()}/></Field>}
   {draft.kind==='correct'&&<>
    <Field label="Your purchase category"><Select required value={category} onChange={e=>setCategory(e.target.value)}>{snapshot.budget.categories.map(c=><option key={c.id} value={c.id}>{c.group} · {c.name}</option>)}</Select></Field>
    {shares.map((share,index)=><Field key={share.id} label={'Share for '+share.name}><input required inputMode="decimal" value={share.amount} onChange={event=>setShares(values=>values.map((s,i)=>i===index?{...s,amount:event.target.value}:s))}/></Field>)}
   </>}
   <Field label="Reason"><textarea aria-label="Reason" required maxLength={300} value={reason} onChange={e=>setReason(e.target.value)} placeholder={draft.kind==='offset'?'Offset our train and food bills.':'Explain what changed.'}/></Field>
   <p className="group-note">Budgets change after everyone approves.</p>
   <div className="button-row"><button className="button primary" type="submit">Request review</button><button type="button" className="button ghost" onClick={cancel}>Cancel</button></div>
  </fieldset>
 </form>;
}

export function SharedChangeReview({id,snapshot,request,onDone,onReverse}:{id:string;snapshot:CloudBudget;request:Request;onDone:()=>void;onReverse:(change:SharedChange)=>void}){
 const [change,setChange]=useState<SharedChange|null>(null),[error,setError]=useState('');
 async function load(clearError=false){if(clearError)setError('');try{setChange(await api<SharedChange>('/shared-changes/'+id));setError('');}catch(error){setError(error instanceof Error?error.message:'The review could not be loaded.');}}
 useEffect(()=>{void load();const timer=setInterval(()=>{if(!document.hidden&&!request.pending&&!request.busy)void load();},5000);return()=>clearInterval(timer);},[id,request.pending,request.busy]);
 if(!change)return error?<><p role="alert">{error}</p><button className="button secondary" onClick={()=>void load(true)}>Try again</button></>:<LoadingState label="Loading this review"/>;
 const currency=change.currency??change.preview?.currency??snapshot.budget.currency,fmt=(n:number)=>money(n,currency),own=change.preview,matching=own?.budgetId===snapshot.id;
 const offset=['offset','reverse_offset'].includes(change.kind),applied=change.state==='applied',canApprove=change.state==='pending'&&change.canApprove&&matching&&!change.problem;
 const approveLabel=change.kind==='offset'?'Approve offset':change.kind==='correct'?'Approve correction':change.kind==='refund'?'Approve refund':'Approve reversal';
 const waiting=change.participants.filter(p=>!p.approved&&!p.isYou),waitingText=waiting.length===1?'Waiting for '+waiting[0].name+'’s review.':`Waiting for ${waiting.length} people to review.`;
 const status=applied?({offset:'Offset recorded',correct:'Bill corrected',refund:'Refund recorded',reverse_payment:'Repayment reversed',reverse_offset:'Offset reversed'}[change.kind]??'Change applied'):change.state==='cancelled'?'Request cancelled':canApprove?'Ready for your review':'Waiting for review';
 const summary=change.state==='cancelled'?'This request was cancelled. Budgets were not changed.':change.kind==='offset'?(applied?'The matching amounts were cleared. No bank payment was recorded.':'The matching amounts will be cleared. Bank balances and spending stay the same.'):change.kind==='refund'?(applied?'The refund is recorded. Money to return appears as a separate balance.':'Record the merchant refund. Money already repaid will be owed back.') :change.kind==='correct'?(applied?'The reviewed correction is recorded.':'Check the updated bill and your budget changes below.'):change.kind==='reverse_offset'?(applied?'The original amounts are owed again. No money moved.':'The amounts cleared by this offset will be owed again. No money moves.'):(applied?'The repayment was reversed. Its history is kept.':'Undo the recorded repayment. No money is sent.');
 const metrics=own?([['cash','Cash in accounts'],['spent','Spending this month'],['receivable','Friends owe you'],['owed','You owe'],['reserved','Cash set aside for friends'],['ready','Available to plan']] as const).filter(([key])=>own.before[key]!==own.after[key]):[];
 function decide(decision:string){request.perform<{change:SharedChange}>('/shared-changes/'+id,{decision,confirmReview:decision==='approve',expectedRevision:own?.revision},result=>setChange(result.change));}
 const impact=own&&<div className="group-own-impact"><p className="group-note">{own.budgetName}. Only changed amounts are shown.</p><dl>{metrics.map(([key,label])=><div key={key}><dt>{label}</dt><dd><span>{fmt(own.before[key])}</span><ArrowRight aria-hidden="true"/><strong>{fmt(own.after[key])}</strong></dd></div>)}</dl>{!!own.categories?.length&&<><h3 className="group-category-heading">Your categories</h3><dl>{own.categories.map(c=><div key={c.id}><dt>Left in {c.name}</dt><dd><span>{fmt(c.beforeLeft)}</span><ArrowRight aria-hidden="true"/><strong>{fmt(c.afterLeft)}</strong></dd></div>)}</dl></>}</div>;
 return <div className="group-review">
  <div className="group-review-status">{applied?<CheckCircle2 aria-hidden="true"/>:<Clock3 aria-hidden="true"/>}<strong>{status}</strong></div>
  {change.amount!==undefined&&<div className="group-review-amount"><strong>{fmt(change.amount)}</strong><span>{change.counterparty?'with '+change.counterparty:change.merchant}</span></div>}
  <p className="group-review-summary">{summary}</p>
  {change.lines&&<div className="group-match-cards">{change.lines.map((line,i)=><div className="group-match" key={i}><div><small>You owe</small><strong>{line.outgoingBill??line.second}</strong><span>{fmt(line.amount)}</span></div><ArrowLeftRight className="group-match-symbol" aria-hidden="true"/><div><small>Owed to you</small><strong>{line.incomingBill??line.first}</strong><span>{fmt(line.amount)}</span></div></div>)}</div>}
  {change.before&&change.after&&<div className="group-change-comparison"><div><small>Original bill</small><strong>{fmt(change.before.total)}</strong><span>{change.before.merchant} · {change.before.date}</span></div><ArrowRight aria-hidden="true"/><div><small>Corrected bill</small><strong>{fmt(change.after.total)}</strong><span>{change.after.merchant} · {change.after.date}</span></div></div>}
  {change.refunds&&<section><h3>Refund shares</h3><div className="group-offset-lines">{change.refunds.map((part,i)=><div key={i}><span>{part.name}<small>{part.extra>0?fmt(part.extra)+' to return':'Reduces the unpaid share'}</small></span><strong>{fmt(part.amount)}</strong></div>)}</div></section>}
  {own&&(offset?<details className="group-review-details"><summary>See your budget changes</summary>{impact}</details>:impact)}
  <details className="group-review-details"><summary>Reason for this change</summary><p>{change.reason}</p></details>
  {change.problem&&<p className="form-error" role="alert">{change.problem}</p>}
  <ul className="group-approvals">{change.participants.map((person,index)=><li key={index}>{person.approved?<CheckCircle2 aria-hidden="true"/>:<Clock3 aria-hidden="true"/>}<span>{person.isYou?'You':person.name}</span><small>{applied?'Reviewed':person.approved?'Approved':'Review needed'}</small></li>)}</ul>
  {change.state==='pending'&&!canApprove&&!change.problem&&<p className="group-note">{own&&!matching?'Open '+own.budgetName+' to approve.':waitingText}</p>}
  <div className="group-review-footer">
   {canApprove?<><button className="button ghost" disabled={!request.canClose()} onClick={onDone}>Back</button><button className="button primary" disabled={request.busy||!!request.pending} onClick={()=>decide('approve')}><Check aria-hidden="true"/>{approveLabel}</button></>:<button className="button primary" disabled={!request.canClose()} onClick={onDone}>Close review<ArrowRight aria-hidden="true"/></button>}
   {(change.state==='pending'||change.canReverse)&&<details className="group-more-actions"><summary><MoreHorizontal aria-hidden="true"/>More actions</summary>{change.state==='pending'&&<button type="button" disabled={request.busy||!!request.pending} onClick={()=>decide('decline')}>Decline this request</button>}{change.canReverse&&<button type="button" disabled={request.busy||!!request.pending} onClick={()=>onReverse(change)}>Request reversal</button>}</details>}
  </div>
 </div>;
}
