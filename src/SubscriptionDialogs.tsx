import {useState} from 'react';
import {CalendarClock,Repeat2} from 'lucide-react';
import type {Props} from './Dialogs';
import type {Entry} from './engine';
import {canUseAccountForEntry,cents,id,money,today} from './engine';
import {addSubscription,canTrackSubscription,subscriptionCosts,trackSubscriptions} from './subscriptions';
import type {SubscriptionFrequency} from './subscriptions';
import {Field,Form,Hint,Modal} from './ui';
import AmountInput from './AmountInput';
import Select from './Select';
import DatePicker from './DatePicker';
import CategoryPicker from './CategoryPicker';
import {displayDate} from './dates';
import './subscriptions.css';

export function AddSubscriptionDialog({b,onClose,commit}:Props){
 const accounts=b.accounts.filter(a=>canUseAccountForEntry(a,'expense'));
 const [accountId,setAccountId]=useState(accounts[0]?.id??'');
 const [categoryId,setCategoryId]=useState(b.categories.find(c=>c.name.toLowerCase()==='subscriptions')?.id??b.categories[0]?.id??'');
 const [amount,setAmount]=useState(''),[frequency,setFrequency]=useState<SubscriptionFrequency>('monthly');
 const [date,setDate]=useState(today());
 const account=accounts.find(a=>a.id===accountId);
 let value=0;try{value=cents(amount);}catch{/* Keep incomplete input editable. */}
 const estimate=value>0?subscriptionCosts([{id:'preview',frequency,nextDate:date,subscription:true,template:{kind:'expense',amount:value} as Entry}]):null;
 return <Modal title="Add subscription" eyebrow={b.name} onClose={onClose}>
  <Form onClose={onClose} label="Add subscription" onSubmit={f=>{
   if(!account||!categoryId)throw new Error('Choose an account and category first.');
   if(value<=0)throw new Error('Enter an amount greater than zero.');
   const entry:Entry={id:id(),kind:'expense',date,amount:value,accountId,categoryId,payee:String(f.get('name')??'').trim(),note:String(f.get('note')??'').trim(),cleared:false};
   commit(addSubscription(b,entry,frequency),'Subscription added. Record each payment after it happens.');onClose();
  }}>
   <p className="muted">Keep track of upcoming payments. Adding a subscription does not record spending.</p>
   <Field label="Subscription name"><input name="name" required maxLength={160} autoFocus placeholder="For example, Netflix or your phone plan"/></Field>
   <div className="field-row">
    <Field label="Payment amount" hint={b.currency}><AmountInput aria-label="Subscription amount" value={amount} onChange={e=>setAmount(e.target.value)} required inputMode="decimal" placeholder="0.00"/></Field>
    <Field label="Repeat"><Select aria-label="Subscription frequency" value={frequency} onChange={e=>setFrequency(e.target.value as SubscriptionFrequency)}><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></Select></Field>
   </div>
   <Field label="Next payment date"><DatePicker aria-label="Next payment date" value={date} onChange={setDate} min={account?.date} required/></Field>
   <div className="field-row">
    <Field label="Pay from"><Select aria-label="Subscription account" value={accountId} onChange={e=>setAccountId(e.target.value)} required>{accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
    <Field label="Category"><CategoryPicker label="Subscription category" value={categoryId} categories={b.categories} groups={b.groups} onChange={setCategoryId}/></Field>
   </div>
   {estimate&&estimate.monthly!==null&&estimate.annual!==null&&<div className="subscription-estimate"><Repeat2 size={18}/><p><strong>{money(estimate.monthly,b.currency)} per month</strong><span>{money(estimate.annual,b.currency)} per year at this price. {frequency==='weekly'?'Based on 52 weekly payments.':'These are cost estimates.'}</span></p></div>}
   <Field label="Note (optional)"><input name="note" maxLength={500} placeholder="Plan name or renewal details"/></Field>
   <Hint>Record the payment from Subscriptions or Transactions after it happens. SpentOn does not charge your account or cancel services.</Hint>
  </Form>
 </Modal>;
}

export function TrackSubscriptionsDialog({b,onClose,commit}:Props){
 const [chosen,setChosen]=useState<Set<string>>(new Set());
 const candidates=(b.schedules??[]).filter(s=>canTrackSubscription(s)&&!s.subscription).sort((a,c)=>a.template.payee.localeCompare(c.template.payee));
 return <Modal title="Track existing payments" eyebrow="SUBSCRIPTIONS" onClose={onClose}>
  <Form onClose={onClose} label="Track selected payments" onSubmit={()=>{
   commit(trackSubscriptions(b,candidates.filter(s=>chosen.has(s.id))),'Selected payments added to Subscriptions.');onClose();
  }}>
   <p className="muted">Choose recurring expenses already in Transactions. Their amounts and dates stay the same.</p>
   <div className="subscription-candidates">{candidates.map(schedule=><label key={schedule.id} className="subscription-candidate">
    <input type="checkbox" checked={chosen.has(schedule.id)} onChange={e=>setChosen(previous=>{const next=new Set(previous);if(e.target.checked)next.add(schedule.id);else next.delete(schedule.id);return next;})}/>
    <span><strong>{schedule.template.payee||'Unnamed recurring expense'}</strong><small>{b.accounts.find(a=>a.id===schedule.template.accountId)?.name} · {schedule.frequency}</small><small><CalendarClock size={13}/>Next: {displayDate(schedule.nextDate)}</small></span>
    <b>{money(schedule.template.amount,b.currency)}</b>
   </label>)}</div>
   {!candidates.length&&<Hint>No untracked recurring expenses are available. Add a subscription to create its schedule.</Hint>}
  </Form>
 </Modal>;
}
