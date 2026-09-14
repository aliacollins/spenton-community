import Select from './Select';
import AmountInput from './AmountInput';
import DatePicker from './DatePicker';
import { useState } from 'react';
import { cents, id, money, today, validateBudget } from './engine';
import type { Budget, Entry } from './engine';
import type { Props } from './Dialogs';
import { Field, Form, Hint, Modal } from './ui';
import { accountEffect, affectsAccount, clearedBalance, isCleared, reconcile, reconciliationSignature, setCleared } from './reconciliation';
import './money-dialogs.css';

function refundParts(b:Budget,purchase:Entry,exclude?:string){
 const totals=new Map<string,number>();
 for(const p of purchase.splits??[{categoryId:purchase.categoryId!,amount:purchase.amount}])totals.set(p.categoryId,(totals.get(p.categoryId)??0)+p.amount);
 for(const e of b.entries.filter(e=>e.refundOf===purchase.id&&e.id!==exclude))for(const p of e.splits??[{categoryId:e.categoryId!,amount:e.amount}])totals.set(p.categoryId,totals.get(p.categoryId)!-p.amount);
 return [...totals].map(([categoryId,amount])=>({categoryId,amount}));
}

export function RefundDialog({dialog,b,onClose,commit}:Props){
 const purchase=dialog.type==='refund'?dialog.purchase:null;
 const existing=dialog.type==='refund'?dialog.entry:undefined;
 const available=purchase?refundParts(b,purchase,existing?.id):[];
 const [amounts,setAmounts]=useState<Record<string,string>>(()=>Object.fromEntries(available.map(p=>[p.categoryId,((existing?(existing.splits??[{categoryId:existing.categoryId,amount:existing.amount}]).filter(s=>s.categoryId===p.categoryId).reduce((n,s)=>n+s.amount,0):p.amount)/100).toFixed(2)])));
 if(!purchase)return null;
 const account=b.accounts.find(a=>a.id===purchase.accountId)!;
 return <Modal title={existing?'Edit linked refund':'Refund a purchase'} eyebrow={purchase.payee} onClose={onClose}><Form onClose={onClose} label="Save refund" onSubmit={f=>{
  const parts=available.map(p=>({categoryId:p.categoryId,amount:cents(amounts[p.categoryId]||'0')}));
  if(parts.some(p=>p.amount<0))throw new Error('Refund amounts cannot be negative.');
  const selected=parts.filter(p=>p.amount>0);if(!selected.length)throw new Error('Enter a refund amount.');
  const entry:Entry={id:existing?.id??id(),kind:'refund',refundOf:purchase.id,accountId:purchase.accountId,date:String(f.get('date')),payee:purchase.payee,amount:selected.reduce((n,p)=>n+p.amount,0),note:String(f.get('note')??'').trim(),cleared:f.get('cleared')==='on',...(selected.length===1?{categoryId:selected[0].categoryId}:{splits:selected})};
  if(entry.date>today())throw new Error('Record a refund after it happens.');
  commit(validateBudget({...b,entries:existing?b.entries.map(e=>e.id===existing.id?entry:e):[...b.entries,entry]}),'Refund saved. Spending and balances recalculated.');onClose();
 }}><Hint>{account.type==='credit'?'The refund reduces card debt and reverses spending. Cash still reserved for this purchase returns to its category. A refund after repayment may become card credit; it does not increase bank cash. Statement and minimum payments stay unchanged.':'The refund returns cash to the original categories and reduces spending. It is not new income.'}</Hint><p className="muted">Original purchase: {purchase.date} · {money(purchase.amount,b.currency)} · {account.name}</p>{available.map(p=><Field key={p.categoryId} label={'Refund: '+b.categories.find(c=>c.id===p.categoryId)?.name} hint={'Up to '+money(p.amount,b.currency)+' remaining'}><AmountInput aria-label={'Refund amount for '+b.categories.find(c=>c.id===p.categoryId)?.name} inputMode="decimal" value={amounts[p.categoryId]??''} onChange={e=>setAmounts({...amounts,[p.categoryId]:e.target.value})}/></Field>)}<Field label="Refund date"><DatePicker name="date" min={purchase.date} max={today()} required defaultValue={existing?.date??today()}/></Field><Field label="Refund note"><input name="note" maxLength={500} defaultValue={existing?.note??''}/></Field><label className="check-label"><input type="checkbox" name="cleared" defaultChecked={existing?.cleared??true}/><span>Cleared in my account</span></label></Form></Modal>;
}

export function ReconcileDialog({dialog,b,onClose,commit}:Props){
 const [accountId,setAccountId]=useState(dialog.type==='reconcile'?(dialog.accountId??b.accounts[0]?.id??''):'');
 const [date,setDate]=useState(today());const [balance,setBalance]=useState('');const [adjust,setAdjust]=useState(false);
 const [entries,setEntries]=useState(b.entries);
 const account=b.accounts.find(a=>a.id===accountId);
 const draft={...b,entries};
 const rows=entries.filter(e=>affectsAccount(e,accountId)&&e.date<=date).sort((a,c)=>c.date.localeCompare(a.date));
 let cleared:number|null=null;try{cleared=clearedBalance(draft,accountId,date);}catch{/* Date or account selection is incomplete. */}
 let difference:number|null=null;try{if(balance&&cleared!==null)difference=(account?.type==='credit'?-cents(balance):cents(balance))-cleared;}catch{/* Amount can be incomplete. */}
 const records=(b.reconciliations??[]).filter(r=>r.accountId===accountId).slice(-5).reverse();
 return <Modal title={account?.type==='investment'?'Update investment balance':'Reconcile an account'} eyebrow={account?.type==='investment'?'MANUALLY TRACKED VALUE':'COMPARE WITH YOUR BANK'} wide onClose={onClose}><Form onClose={onClose} label={account?.type==='investment'?'Save balance':'Finish reconciliation'} onSubmit={f=>{
  const target=cents(balance)*(account?.type==='credit'?-1:1);
  commit(reconcile(draft,accountId,date,target,adjust?String(f.get('reason')??''):''),'Account reconciled');onClose();
 }}><div className="field-row"><Field label="Reconciliation account"><Select aria-label="Reconciliation account" value={accountId} onChange={e=>{setAccountId(e.target.value);setBalance('');setAdjust(false);}} required>{b.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field><Field label="Balance date"><DatePicker required min={account?.date} max={today()} value={date} onChange={setDate}/></Field></div><Field label={account?.type==='investment'?'Current investment value':account?.type==='credit'?'Bank amount owed (negative for credit)':'Bank cleared balance'}><AmountInput aria-label={account?.type==='investment'?'Investment balance':'Bank reconciliation balance'} inputMode="decimal" required value={balance} onChange={e=>setBalance(e.target.value)}/></Field><Hint>{account?.type==='investment'?'Enter the total value shown by your investment provider. Record any missing transfers first, then use an adjustment with a reason for changes in value. This does not change Available to plan.':"Use your bank's posted balance, excluding pending transactions. Check the entries that have cleared through this date. Each transfer account can clear separately."}</Hint><div className="reconcile-summary"><span>Cleared balance in SpentOn <strong>{cleared===null?'Choose a valid date':money(account?.type==='credit'?-cleared:cleared,b.currency)}</strong></span><span>Balance difference <strong>{difference===null?'Enter bank balance':money(difference,b.currency)}</strong></span></div><div className="reconcile-entries">{rows.map(e=><label className="reconcile-entry" key={e.id}><input type="checkbox" aria-label={'Cleared: '+e.payee} checked={isCleared(e,accountId)} onChange={event=>setEntries(entries.map(x=>x.id===e.id?setCleared(x,accountId,event.target.checked):x))}/><span><strong>{e.payee}</strong><small>{e.date} · {e.kind}</small></span><strong>{money(accountEffect(e,accountId),b.currency)}</strong></label>)}{!rows.length&&<p className="muted">No transactions through this date. The opening balance is included.</p>}</div>{difference!==null&&difference!==0&&<><label className="check-label"><input type="checkbox" checked={adjust} onChange={e=>setAdjust(e.target.checked)}/><span>Add a balance adjustment of {money(difference,b.currency)}</span></label>{adjust&&<Field label="Adjustment reason"><input name="reason" required maxLength={500} placeholder="Explain the difference"/></Field>}<Hint>{account?.type==='investment'?'This changes your investment value and net worth. Available to plan, spending and income stay the same.':account?.type==='credit'?'An adjustment changes card debt or credit. It does not create cash, spending, income, or a payment to your issuer.':'An adjustment changes the balance and Available to plan. It is excluded from spending and income reports.'}</Hint></>}{records.length>0&&<div className="reconciliation-history"><h3>Recent reconciliations</h3>{records.map(r=><p key={r.id}>{r.date} · {money(account?.type==='credit'?-r.balance:r.balance,b.currency)} · <strong>{reconciliationSignature(b,r.accountId,r.date)===r.signature?'Matches recorded history':'Review: earlier records changed'}</strong></p>)}</div>}</Form></Modal>;
}
