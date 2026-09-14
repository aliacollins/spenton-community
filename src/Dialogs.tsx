import CategoryAppearance from './CategoryAppearance';
import SuggestionInput from './SuggestionInput';
import Select from './Select';
import AmountInput from './AmountInput';
import { useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, ChevronDown, CreditCard, Download, Upload, Plus, ShieldCheck, Target } from 'lucide-react';
import { Modal, Form, Field, Hint } from './ui';
import { canUseAccountForEntry, allocate, allocationCapacity, calculate, bucketAvailable, cents, id, money, monthEnd, thisMonth, today, validateBudget } from './engine';
import type { Account, Budget, Category, Entry, Schedule, Totals } from './engine';
import { download, exportBudget } from './storage';
import ImportDialog from './ImportDialog';
import { TargetFields } from './TargetFields';
import { parseTargetFields } from './targets';
import { RefundDialog, ReconcileDialog } from './MoneyDialogs';
import { nextOccurrence, saveTransaction, updateSchedule } from './recurring';
import type { RepeatInterval } from './recurring';
import { displayDate } from './dates';
import DatePicker from './DatePicker';
import { budgetResetRestriction, freshBudgetForReplacement, resetBudget } from './budget-reset';
import OnboardingGuide from './OnboardingGuide';
import StarterCategories, { starterCategories } from './StarterCategories';
import { savedPayees } from './payees';
import PayeePicker from './PayeePicker';
import CategoryPicker from './CategoryPicker';
import pipIllustration from './brand/pip.svg';
import './transaction-dialog.css';
import PlanMoneyDialog from './PlanMoneyDialog';
import {AddSubscriptionDialog,TrackSubscriptionsDialog} from './SubscriptionDialogs';

export type DialogState=
 |{type:'transaction';kind?:Entry['kind'];accountId?:string;toAccountId?:string;entry?:Entry;schedule?:Schedule}
 |{type:'subscription'}
 |{type:'trackSubscriptions'}
 |{type:'refund';purchase:Entry;entry?:Entry}
 |{type:'reconcile';accountId?:string}
 |{type:'allocation';from?:string;to?:string;amount?:number}
 |{type:'category';category?:Category;parent?:Category}
 |{type:'goal';category:Category}
 |{type:'categoryGroup'}
 |{type:'categorySuggestions'}
 |{type:'cashShortfalls'}
 |{type:'account'}
 |{type:'statement';account:Account}
 |{type:'settings'}
 |{type:'reset'}
 |{type:'new'}
 |{type:'plan'}
 |{type:'import'}
 |{type:'help'}
 |{type:'pipGuide'}
 |{type:'confirm';title:string;description:string;action:()=>void;label:string;destructive?:boolean};
export type Props={dialog:DialogState;b:Budget;t:Totals;month:string;onClose:()=>void;commit:(b:Budget,message:string,allowRecovery?:boolean,serviceAction?:'budget.saved'|'import.completed')=>void;open:(d:DialogState)=>void;recovery:string|null;resetBlockedReason?:string|null;onWorkspace?:()=>void;onLearn?:()=>void;learningLabel?:string};
const read=(f:FormData,name:string)=>String(f.get(name)??'').trim();
const positive=(value:string)=>{const v=cents(value);if(v<=0)throw new Error('Enter an amount greater than zero.');return v;};
const dateFor=(month:string)=>month===thisMonth()?today():monthEnd(month);
export default function Dialogs(props:Props){
 const {dialog,b,t,month,onClose,commit,open,recovery}=props;
 const categoryGoal=useRef<HTMLDetailsElement>(null);
 const currency=b.currency;
 const save=(next:Budget,message:string,replace=false)=>{commit(validateBudget(next),message,replace);onClose();};
 const resetRestriction=props.resetBlockedReason??budgetResetRestriction(b);
 if((dialog.type==='reset'||dialog.type==='new')&&resetRestriction)return <Modal title="Keep shared history" eyebrow={b.name} onClose={onClose}><div className="form-body"><p>{resetRestriction}</p><Hint>Create a separate budget to start fresh. This budget's shared history will stay available.</Hint><button type="button" className="button secondary" onClick={()=>exportBudget(b)}><Download size={16}/>Export this budget</button></div><div className="modal-footer"><button type="button" className="button ghost" onClick={onClose}>Keep this budget</button>{props.onWorkspace&&<button type="button" className="button primary" onClick={()=>{onClose();props.onWorkspace?.();}}>Budgets &amp; account<ArrowRight size={16}/></button>}</div></Modal>;
 if(dialog.type==='pipGuide')return <OnboardingGuide onClose={onClose} onLearn={props.onLearn} learningLabel={props.learningLabel}/>;
 if(dialog.type==='subscription')return <AddSubscriptionDialog {...props}/>;
 if(dialog.type==='trackSubscriptions')return <TrackSubscriptionsDialog {...props}/>;
 if(dialog.type==='cashShortfalls')return <CashShortfallsDialog {...props}/>;
 if(dialog.type==='refund')return <RefundDialog {...props}/>;
 if(dialog.type==='reconcile')return <ReconcileDialog {...props}/>;
 if(dialog.type==='reset')return <ResetBudgetDialog {...props}/>;
 if(dialog.type==='transaction')return <TransactionDialog {...props}/>;
 if(dialog.type==='allocation')return <AllocationDialog {...props}/>;
 if(dialog.type==='import')return <ImportDialog {...props}/>;
 if(dialog.type==='categorySuggestions')return <Modal title="Find your categories" eyebrow="A LITTLE HELP FROM PIP" onClose={onClose}><Form onClose={onClose} label="Add selected categories" onSubmit={f=>{const categories=starterCategories(f.getAll('starter').map(String)).filter(c=>!b.categories.some(x=>x.name.toLowerCase()===c.name.toLowerCase()));if(!categories.length)throw new Error('Choose at least one new category.');save({...b,categories:[...b.categories,...categories]},'Your categories are ready');}}><StarterCategories existing={b.categories.map(c=>c.name)} initial={[]}/></Form></Modal>;
 if(dialog.type==='categoryGroup')return <Modal title="Add a main category" eyebrow="ORGANIZE YOUR BUDGET" onClose={onClose}><Form onClose={onClose} label="Add main category" onSubmit={f=>{
  const name=read(f,'name');
  const groups=[...new Set([...(b.groups??[]),...b.categories.map(c=>c.group)])];
  if(groups.some(g=>g.toLowerCase()===name.toLowerCase()))throw new Error('A category with that name already exists.');
  save({...b,groups:[...groups,name]},'Main category added. Use Add subcategory beside it to add your spending categories.');
 }}><Field label="Category name"><input name="name" maxLength={60} required placeholder="For example, Home or Travel" autoFocus/></Field><p className="muted">This creates a heading, such as Home. Add subcategories under it, such as Rent and Utilities, to plan money.</p></Form></Modal>;
 if(dialog.type==='goal'){
  const category=b.categories.find(c=>c.id===dialog.category.id);
  if(!category)return null;
  return <Modal className="modal-standard goal-editor" title={category.target?'Edit savings goal':'Set a savings goal'} eyebrow={category.name} onClose={onClose}><Form onClose={onClose} label="Save goal" onSubmit={f=>{
   const settings=parseTargetFields(f,category);
   save({...b,categories:b.categories.map(c=>c.id===category.id?{...c,...settings}:c)},settings.target?'Savings goal saved':'Savings goal removed');
  }}><TargetFields category={category} month={month} currency={currency} totals={t.categories[category.id]}/></Form></Modal>;
 }
 if(dialog.type==='category'){
  const c=dialog.category;
  const parent=dialog.parent??b.categories.find(x=>x.id===c?.parentId);
  return <Modal title={c?'Edit category':'Add a category'} eyebrow="YOUR BUDGET, YOUR PRIORITIES" onClose={onClose}><Form onClose={onClose} label={c?'Save category':'Add category'} onSubmit={f=>{
   let goal;
   try{goal=parseTargetFields(f,c);}catch(error){if(categoryGoal.current)categoryGoal.current.open=true;throw error;}
   const category:Category={id:c?.id??id(),name:read(f,'name'),group:parent?.group??read(f,'group'),...(parent?{parentId:parent.id}:{}),icon:read(f,'icon'),color:read(f,'color'),...goal};
   if(b.categories.some(x=>x.id!==c?.id&&x.name.toLowerCase()===category.name.toLowerCase()))throw new Error('A category with that name already exists.');
   save({...b,categories:c?b.categories.map(x=>x.id===c.id?category:x.parentId===c.id?{...x,group:category.group}:x):[...b.categories,category]},c?'Category updated':parent?'Subcategory added':'Category added');
  }}>
   <div className="category-editor-fields">
    <div className="category-identity-fields">
     <Field label="Category name"><input name="name" required maxLength={80} defaultValue={c?.name} placeholder="Something that matters to you" autoFocus/></Field>
     <Field label="Main category" hint={parent?'This subcategory uses its parent’s main category.':'Choose a heading or type a new one.'}><SuggestionInput label="Main category" name="group" required maxLength={60} readOnly={!!parent} defaultValue={parent?.group??c?.group??b.groups?.[0]??b.categories[0]?.group??'Everyday essentials'} options={[...new Set([...(b.groups??[]),...b.categories.map(c=>c.group)])]} menuLabel="Main categories" emptyLabel="Type a name to add a main category."/></Field>
    </div>
    {parent&&<p className="muted">Subcategory of <strong>{parent.name}</strong>. Each row has its own planned amount and spending.</p>}
    <CategoryAppearance initialIcon={c?.icon} initialColor={c?.color}/>
    <details ref={categoryGoal} className="category-goal-settings" onInvalidCapture={event=>{
     event.currentTarget.open=true;
     const control=event.target;
     requestAnimationFrame(()=>{
      if(!(control instanceof HTMLElement)||!control.isConnected)return;
      const first=control.closest('form')?.querySelector('input:invalid,select:invalid,textarea:invalid');
      if(first===control){control.scrollIntoView({block:'nearest'});control.focus({preventScroll:true});}
     });
    }}>
     <summary><Target size={20} aria-hidden="true"/><span><strong>Savings goal</strong><small>Optional. Set an amount and timeline.</small></span><ChevronDown size={18} aria-hidden="true"/></summary>
     <div className="category-goal-content">
      <TargetFields category={c} month={month} currency={currency} totals={c?t.categories[c.id]:undefined}/>
     </div>
    </details>
   </div>
  </Form></Modal>;
 }
 if(dialog.type==='account')return <AccountDialog {...props}/>;
 if(dialog.type==='statement'){
  const a=dialog.account;
  return <Modal title="Card statement" eyebrow={a.name} onClose={onClose}><Form onClose={onClose} label="Save statement" onSubmit={f=>{
   const amount=cents(read(f,'amount')),minimum=cents(read(f,'minimum')||'0'),closed=read(f,'closed'),due=read(f,'due');
   if(amount<0||minimum<0||minimum>amount)throw new Error('Minimum due must be between zero and the statement amount.');
   if(due<=closed)throw new Error('The due date must be after the statement closing date.');
   save({...b,accounts:b.accounts.map(x=>x.id===a.id?{...x,statement:{amount,minimum,closed,due}}:x)},'Statement updated');
  }}>
   <Hint>Copy these amounts from your card issuer. Purchases after the closing date are separate from this bill. Recorded payments after closing reduce the amount still to pay.</Hint>
   <div className="field-row"><Field label="Statement amount"><AmountInput name="amount" required inputMode="decimal" defaultValue={((a.statement?.amount??t.cards[a.id].owed)/100).toFixed(2)} autoFocus/></Field><Field label="Minimum due"><AmountInput name="minimum" required inputMode="decimal" defaultValue={((a.statement?.minimum??0)/100).toFixed(2)}/></Field></div>
   <div className="field-row"><Field label="Statement closed"><DatePicker aria-label="Statement closed" name="closed" required defaultValue={a.statement?.closed??today()} max={today()}/></Field><Field label="Payment due"><DatePicker aria-label="Payment due" name="due" required defaultValue={a.statement?.due??today()}/></Field></div>
  </Form></Modal>;
 }
 if(dialog.type==='plan')return <PlanMoneyDialog {...props}/>;
 if(dialog.type==='new')return <Modal title="Replace this budget" eyebrow="A FRESH START" onClose={onClose}><Form onClose={onClose} label="Replace budget" submitTone="danger" onSubmit={f=>{
  const next=freshBudgetForReplacement(b,read(f,'currency') as Budget['currency']);next.name=read(f,'name');
  const opening=cents(read(f,'opening'));if(opening<0)throw new Error('For this first cash account, enter a balance of zero or more.');
  next.accounts.push({id:id(),name:read(f,'account'),type:'checking',opening,date:today(),lastFour:''});
  save(next,'Your budget is ready. Start with the money you have.',true);
 }}><p className="muted">Start with one account and a few simple categories. This budget is saved to your SpentOn account.</p>
  <Field label="Budget name"><input name="name" defaultValue="My everyday budget" required maxLength={80} autoFocus/></Field>
  <Field label="Budget currency"><Select name="currency" defaultValue={b.currency}>{['USD','INR','EUR','GBP','CAD','AUD'].map(c=><option key={c}>{c}</option>)}</Select></Field>
  <div className="field-row"><Field label="First account"><input name="account" required defaultValue="Everyday checking" maxLength={80}/></Field><Field label="Current balance"><AmountInput name="opening" required defaultValue="0.00" inputMode="decimal"/></Field></div>
  <label className="check-label"><input type="checkbox" required/> <span>{b.demo?'Replace the sample budget with my own.':'Replace this saved budget. I have exported anything I want to keep.'}</span></label>
 </Form></Modal>;
 if(dialog.type==='settings')return <Modal title="Budget settings" eyebrow="BUDGET SETTINGS" onClose={onClose}><Form onClose={onClose} label="Save settings" onSubmit={f=>save({...b,name:read(f,'name')},'Settings saved')}>
  <Field label="Budget name"><input name="name" defaultValue={b.name} required maxLength={80} autoFocus/></Field>
  <div className="setting-line"><span>Currency</span><strong>{b.currency}</strong></div>
  <p className="small muted">Currency cannot change after you create a budget.</p>
  <div className="settings-section"><h3>Budget backups</h3><p className="small muted">Export a backup to keep a separate copy of this budget.</p>
   <div className="button-row"><button type="button" className="button secondary" onClick={()=>exportBudget(b)}><Download size={16}/>Export backup</button><label className="button secondary file-label"><Upload size={16}/>Restore backup<input type="file" accept=".json,application/json" onChange={async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{if(file.size>8_000_000)throw new Error('Use a backup smaller than 8 MB.');const next=validateBudget(JSON.parse(await file.text()));if(next.version<b.version)next.version=b.version;open({type:'confirm',destructive:true,title:'Restore this budget?',description:`“${next.name}” contains ${next.accounts.length} accounts and ${next.entries.length} records. This replaces the budget currently open in your account.`,label:'Restore budget',action:()=>save(next,'Budget restored',true)});}
    catch(err){open({type:'confirm',title:'That backup could not be opened',description:err instanceof Error?err.message:'Invalid backup.',label:'Back to settings',action:()=>open({type:'settings'})});}
   }}/></label></div>
   {recovery!==null&&<button type="button" className="text-button" onClick={()=>download(recovery,'spenton-recovery.json')}>Download original recovery file</button>}
  </div>
  <div className="settings-section"><h3>Reset this budget</h3><p className="small muted">Start at zero with starter categories, or keep your account and category structure.</p><button type="button" className="button secondary" onClick={()=>open({type:'reset'})}>Reset budget</button></div>
  <div className="settings-section"><h3>Replace this budget</h3><div className="button-row"><button type="button" className="button secondary" onClick={()=>open({type:'new'})}><Plus size={16}/>Replace this budget</button></div></div>
 </Form></Modal>;
 if(dialog.type==='confirm')return <Modal title={dialog.title} onClose={onClose}><Form onClose={onClose} onSubmit={()=>dialog.action()} label={dialog.label} submitIcon={false} submitTone={dialog.destructive?'danger':'primary'}><p className="muted">{dialog.description}</p></Form></Modal>;
 return <Modal title="How your budget works" eyebrow="WELCOME TO SPENTON" onClose={onClose}><div className="form-body help-content"><p>Plan with money you have. Update your category amounts when needed.</p><div><span>01</span><section><h3>Make a plan</h3><p>Set aside is money added minus money moved out this month. Spent is purchases minus refunds. Left includes money from earlier months.</p></section></div><div><span>02</span><section><h3>Keep card payments clear</h3><p>When you use category cash for a card purchase, it is set aside for repayment. Your bank balance changes when you pay.</p></section></div><div><span>03</span><section><h3>Keep it yours</h3><p>Enter transactions yourself or import a CSV. There are no bank connections. Export your budget whenever you like.</p></section></div><Hint>Your budget saves to your account. Open Budgets &amp; account to switch budgets or redeem a coupon.</Hint></div><div className="modal-footer"><button className="button primary" onClick={onClose}>Got it <ArrowRight size={16}/></button></div></Modal>;
}

function AccountDialog({b,dialog,onClose,commit}:Props){
 const [type,setType]=useState<Account['type']>('checking'),[opening,setOpening]=useState(''),[reserveNow,setReserveNow]=useState(true),[reserveAmount,setReserveAmount]=useState<string|null>(null);
 if(dialog.type!=='account')return null;
 let owed=0;try{owed=Math.max(0,cents(opening||'0'));}catch{/* Keep incomplete typing editable. */}
 const ready=calculate(b,thisMonth()).ready,suggested=Math.min(Math.max(0,ready),owed);
 const reserveText=reserveAmount??(suggested/100).toFixed(2);let preview=0;try{preview=reserveNow?Math.max(0,cents(reserveText||'0')):0;}catch{/* Validated on submit. */}
 return <Modal title="Add an account" eyebrow="MANUAL ACCOUNTS" onClose={onClose}><Form onClose={onClose} label="Add account" onSubmit={f=>{
  const entered=cents(opening);
  const account:Account={id:id(),name:read(f,'name'),type,opening:type==='credit'?-entered:entered,date:read(f,'date'),lastFour:''};
  if(b.accounts.some(a=>a.name.toLowerCase()===account.name.toLowerCase()))throw new Error('An account with that name already exists.');
  let next=validateBudget({...b,accounts:[...b.accounts,account]});
  if(type==='credit'&&entered>0&&reserveNow){const amount=cents(reserveText);if(amount<0||amount>entered)throw new Error('Set aside an amount between zero and the debt owed.');if(amount>0)next=allocate(next,'ready','card:'+account.id,amount,today());}
  commit(next,'Account added'+(type==='credit'&&preview>0?' with cash set aside for repayment':''));onClose();
 }}><Field label="Account name"><input name="name" required maxLength={80} placeholder={type==='investment'?'Stocks, mutual funds or retirement':type==='credit'?'Everyday Visa':b.currency==='INR'?'HDFC salary, savings, or cash wallet':'Salary account or cash wallet'} autoFocus/></Field>
  <Field label="Account type"><Select aria-label="Account type" value={type} onChange={e=>setType(e.target.value as Account['type'])}><option value="checking">Checking / current / cash wallet</option><option value="savings">Savings account</option><option value="credit">Credit card</option><option value="investment">Investment account</option></Select></Field>
  <div className="field-row"><Field label={type==='credit'?'Amount owed':'Opening balance'} hint={type==='credit'?'Enter debt as a positive amount. A negative amount means the card issuer owes you.':undefined}><AmountInput aria-label={type==='credit'?'Amount owed':'Opening balance'} name="opening" required inputMode="decimal" placeholder="0.00" value={opening} onChange={e=>{setOpening(e.target.value);setReserveAmount(null);}}/></Field><Field label="Balance as of"><DatePicker aria-label="Balance as of" name="date" required max={today()} defaultValue={today()}/></Field></div>
  {type==='credit'&&owed>0&&<div className="opening-reserve"><label className="check-label"><input type="checkbox" checked={reserveNow} onChange={e=>setReserveNow(e.target.checked)}/><span>Set aside cash for this opening debt</span></label><p>Setting cash aside reduces Available to plan. It does not pay the card.</p>{reserveNow&&<Field label="Cash to set aside"><AmountInput inputMode="decimal" value={reserveText} onChange={e=>setReserveAmount(e.target.value)} required/></Field>}<dl><div><dt>Available to plan</dt><dd>{money(ready-preview,b.currency)}</dd></div><div><dt>Opening debt still needing cash</dt><dd>{money(Math.max(0,owed-preview),b.currency)}</dd></div></dl></div>}
  <Hint>{type==='investment'?'Investment balances count toward net worth, but are excluded from Available to plan. Use Update balance to record changes in value.':type==='credit'?'This records your existing card balance. Enter your current statement after adding the card. Setting cash aside does not pay the card or change your bank balance.':'Use the balance before any transactions you plan to enter. Money already spent before this date belongs in your opening balance.'}</Hint>
 </Form></Modal>;
}

function TransactionDialog({dialog,b,month,onClose,commit,open}:Props){
 const initial=dialog.type==='transaction'?dialog:undefined;
 const existing=initial?.entry,schedule=initial?.schedule,source=existing??schedule?.template;
 const [kind,setKind]=useState<Entry['kind']>(source?.kind??initial?.kind??'expense');
 const [frequency,setFrequency]=useState<RepeatInterval>(schedule&&schedule.frequency!=='once'?schedule.frequency:'none');
 const [showOptions,setShowOptions]=useState(!!source?.note||!!schedule);
 const [split,setSplit]=useState(!!source?.splits);
 const [parts,setParts]=useState(source?.splits?.map(s=>({categoryId:s.categoryId,amount:(s.amount/100).toFixed(2)}))??[{categoryId:b.categories[0]?.id??'',amount:''},{categoryId:b.categories[1]?.id??b.categories[0]?.id??'',amount:''}]);
 const [accountId,setAccountId]=useState(source?.accountId??initial?.accountId??b.accounts[0]?.id??'');
 const [categoryId,setCategoryId]=useState(source?.categoryId??b.categories.find(c=>c.id==='groceries')?.id??b.categories[0]?.id??'');
 const [amount,setAmount]=useState(source?(source.amount/100).toFixed(2):'');
 const [entryDate,setEntryDate]=useState(schedule?.nextDate??existing?.date??today());
 const [destinationId,setDestinationId]=useState(source?.toAccountId??initial?.toAccountId??'');
 const eligible=b.accounts.filter(a=>canUseAccountForEntry(a,kind));
 const selected=eligible.find(a=>a.id===accountId)??eligible[0];
 const isCard=selected?.type==='credit';let preview=0;try{preview=Math.max(0,cents(amount||'0'));}catch{/* Input can be incomplete. */}
 const payees=savedPayees(b,kind);
 const [payee,setPayee]=useState(source?.payee??'');
 const destinations=b.accounts.filter(a=>kind==='payment'?a.type==='credit':a.type!=='credit'&&a.id!==selected?.id);
 const destination=destinations.find(a=>a.id===destinationId)??destinations[0];
 const scheduled=!!schedule||entryDate>today();
 let repeatDate='';try{if(frequency!=='none')repeatDate=scheduled?entryDate:nextOccurrence({id:'preview',frequency,nextDate:entryDate,template:{date:entryDate} as Entry});}catch{/* Wait for a complete valid date. */}
 const previewMonth=entryDate.slice(0,7);
 const previewBefore=useMemo(()=>calculate(b,previewMonth||thisMonth()),[b,previewMonth]);
 let splitDifference:number|null=null;try{splitDifference=cents(amount)-parts.reduce((sum,p)=>sum+cents(p.amount||'0'),0);}catch{/* Wait for a complete amount. */}
 const previewTotals=useMemo(()=>{
  if(existing||!selected||preview<=0||scheduled)return null;
  try{
   const entry:Entry={id:'transaction-preview',kind,date:entryDate,amount:preview,accountId:selected.id,payee:'Preview',note:'',cleared:true,...(kind==='expense'?(split?{splits:parts.map(p=>({categoryId:p.categoryId,amount:positive(p.amount)}))}:{categoryId}):{}),...(['payment','transfer'].includes(kind)?{toAccountId:destination?.id}:{})};
   return calculate(validateBudget({...b,entries:[...b.entries,entry]}),previewMonth);
  }catch{return null;}
 },[b,existing,selected,preview,scheduled,kind,entryDate,split,parts,categoryId,destination,previewMonth]);
 const accountAfter=selected&&previewTotals?previewTotals.balances[selected.id]:0;
 const funded=isCard&&previewTotals?Math.max(0,previewTotals.cards[selected!.id].reserve-previewBefore.cards[selected!.id].reserve):0;
 const typeChoices=[{kind:'expense',label:'Expense',hint:'Money out',icon:ArrowUpRight},{kind:'income',label:'Income',hint:'Money in',icon:ArrowDownLeft},{kind:'transfer',label:'Transfer',hint:'Between accounts',icon:ArrowLeftRight},{kind:'payment',label:'Card payment',hint:'Repay card debt',icon:CreditCard}] as const;
 return <Modal guideMessage={scheduled?'Scheduled entries affect your budget only when you record them.':kind==='income'?'Income you record increases Available to plan.':kind==='payment'?'A card payment reduces cash and card debt. Spending stays the same.':kind==='transfer'?'Account balances change. Your spending and category amounts stay the same.':isCard?'Available category cash is set aside for card repayment. Your bank balance changes when you pay the card.':previewTotals&&!split?`This category will have ${money(previewTotals.categories[categoryId]?.available??0,b.currency)} left. Saving updates the account and category.`:'Choose the account and spending category. Saving updates both.'} title={schedule?'Edit scheduled transaction':existing?'Edit transaction':'Add a transaction'} eyebrow="TRANSACTION" className={'transaction-create-modal tx-'+kind} onClose={onClose}>
 <div className="tx-type-choices" role="group" aria-label="Transaction type">{typeChoices.map(x=><button key={x.kind} aria-label={x.label} aria-pressed={kind===x.kind} className={'tx-type tx-type-'+x.kind} onClick={()=>{if(x.kind!==kind){setKind(x.kind);setFrequency('none');setShowOptions(false);}}} type="button"><span className="tx-type-icon"><x.icon size={20}/></span><span><strong>{x.label}</strong><small>{x.hint}</small></span></button>)}</div>
 <Form onClose={onClose} label={schedule?'Save schedule':scheduled?'Schedule entry':kind==='payment'?'Record card payment':'Save transaction'} onSubmit={f=>{
  if(!selected)throw new Error('Add a cash account first.');
  if(kind==='expense'&&!categoryId)throw new Error('Add a spending category first.');
  const value=positive(amount);
  const entry:Entry={id:existing?.id??id(),scheduleKey:existing?.scheduleKey,clearedTo:existing?.clearedTo,kind,date:read(f,'date'),amount:value,accountId:selected.id,payee:read(f,'payee')||(schedule?source?.payee:'')||(kind==='payment'?'Card payment':'Account transfer'),note:read(f,'note'),cleared:f.get('cleared')==='on',...(kind==='expense'?(split?{splits:parts.map(p=>({categoryId:p.categoryId,amount:positive(p.amount)}))}:{categoryId}):{}),...(['payment','transfer'].includes(kind)?{toAccountId:read(f,'toAccountId')}:{})};
  commit(schedule?updateSchedule(b,schedule,entry,frequency):saveTransaction(b,entry,frequency,existing?.id),schedule?'Scheduled transaction updated':existing?'Transaction updated':scheduled?'Transaction scheduled. Find it in Transactions.':'Transaction saved');onClose();
 }}>
  <div className="tx-amount-hero">
   <Field label={scheduled?'Scheduled amount':kind==='income'?'How much came in?':kind==='transfer'?'How much did you move?':kind==='payment'?'How much did you pay?':'How much did you spend?'}><div className="amount-input tx-amount-input"><span>{b.currency}</span><AmountInput value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal" required placeholder="0.00" autoFocus aria-label="Transaction amount"/></div></Field>
   <div className="tx-pip-note" aria-hidden="true"><img src={pipIllustration} alt=""/><span>Check the details<br/>before saving.</span></div>
  </div>
  <div className="tx-entry-fields">
   {(!eligible.length||(['payment','transfer'].includes(kind)&&!destinations.length))&&<Hint>{kind==='payment'?'Add a cash account and a credit card in Accounts → Add account.':kind==='transfer'?'Add the receiving account in Accounts → Add account, then return to record this transfer.':'Add an account in Accounts → Add account, then return to record this entry.'}</Hint>}
   <div className="field-row tx-account-date"><Field label={kind==='income'?'Into account':kind==='payment'?'Pay from':kind==='transfer'?'From account':'Paid from'}><Select value={selected?.id??''} onChange={e=>setAccountId(e.target.value)} required aria-label="Transaction account">{!eligible.length&&<option value="">Add an account first</option>}{eligible.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select>{selected&&<small>Recorded balance: {money(previewBefore.balances[selected.id],b.currency)}</small>}</Field><Field label="Date"><DatePicker aria-label="Date" name="date" value={entryDate} onChange={setEntryDate} min={selected?.date&&destination?.date&&['transfer','payment'].includes(kind)?[selected.date,destination.date].sort().at(-1):selected?.date} max={existing?today():undefined} required/></Field></div>
   <div className="field-row tx-payee-category">
    {['expense','income'].includes(kind)&&<Field label={kind==='income'?'Received from':'Who did you pay?'}><PayeePicker label={kind==='income'?'Received from':'Payee'} name="payee" value={payee} payees={payees} onChange={setPayee} placeholder={kind==='income'?'Choose or type who paid you':'Choose or type a payee'}/></Field>}
    {kind==='expense'&&!split&&<Field label="Category"><CategoryPicker label="Transaction category" value={categoryId} categories={b.categories} groups={b.groups} onChange={setCategoryId}/></Field>}
    {['payment','transfer'].includes(kind)&&<Field label={kind==='payment'?'To credit card':'To account'}><Select name="toAccountId" aria-label={kind==='payment'?'Payment destination':'Transfer destination'} value={destination?.id??''} onChange={e=>setDestinationId(e.target.value)} required>{!destinations.length&&<option value="">{kind==='payment'?'Add a credit card first':'Add a receiving account in Accounts → Add account'}</option>}{destinations.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>}
   </div>
   {kind==='expense'&&<div className="tx-split-section"><label className="check-label"><input type="checkbox" checked={split} onChange={e=>setSplit(e.target.checked)}/><span>Split across categories</span></label>{split&&<div className="split-editor">{parts.map((part,i)=><div className="field-row" key={i}><Field label={'Split category '+(i+1)}><Select aria-label={'Split category '+(i+1)} value={part.categoryId} onChange={e=>setParts(parts.map((p,n)=>n===i?{...p,categoryId:e.target.value}:p))}>{b.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field><Field label={'Split amount '+(i+1)}><AmountInput aria-label={'Split amount '+(i+1)} inputMode="decimal" required value={part.amount} onChange={e=>setParts(parts.map((p,n)=>n===i?{...p,amount:e.target.value}:p))}/></Field>{parts.length>2&&<button type="button" aria-label={'Remove split '+(i+1)} onClick={()=>setParts(parts.filter((_,n)=>n!==i))}>Remove</button>}</div>)}<button type="button" className="text-button" onClick={()=>setParts([...parts,{categoryId:b.categories[0]?.id??'',amount:''}])}>+ Add split</button><p className="muted split-balance" role="status">{splitDifference===null?'Enter the total and each split amount.':splitDifference>0?money(splitDifference,b.currency)+' left to split':splitDifference<0?money(-splitDifference,b.currency)+' over the total':parts.every(p=>{try{return cents(p.amount)>0;}catch{return false;}})?'All amounts match':'Enter an amount for each category.'}</p></div>}</div>}
  </div>
  {!existing&&selected&&previewTotals&&<div className={'transaction-impact '+(!isCard&&accountAfter<0?'negative-impact':'')} aria-label="Transaction preview"><div><span>{selected.name+(isCard?' debt after this ':' balance after this ')+(kind==='payment'?'card payment':kind)}</span><strong>{money(isCard?previewTotals.cards[selected.id].owed:accountAfter,b.currency)}</strong></div>{destination&&['payment','transfer'].includes(kind)&&<div><span>{destination.name+(kind==='payment'?' debt after this card payment':' balance after this transfer')}</span><strong>{money(kind==='payment'?previewTotals.cards[destination.id].owed:previewTotals.balances[destination.id],b.currency)}</strong></div>}<div><span>Available to plan</span><strong>{money(previewTotals.ready,b.currency)}</strong></div>{!isCard&&accountAfter<0&&<p>{selected.name} would be below zero. Check the amount or recorded balance before saving.</p>}{entryDate.slice(0,7)!==month&&<p>This entry affects {previewMonth}.</p>}</div>}
  {isCard&&!existing&&previewTotals&&<div className="transaction-explanation"><ShieldCheck size={19}/><div><strong>{money(funded,b.currency)} set aside for card repayment</strong><p>{previewTotals.cards[selected!.id].unbacked>previewBefore.cards[selected!.id].unbacked?'Any amount without cash still needs covering.':'Category cash is set aside for repayment. Your bank balance stays the same.'}</p></div></div>}
  {!existing&&scheduled&&<Hint>This entry is scheduled for {displayDate(entryDate)}. Find it under Scheduled transactions. Record it after it happens to update your balances.</Hint>}
  {schedule&&[selected?.date,['payment','transfer'].includes(kind)?destination?.date:undefined].some(date=>date&&date>schedule.template.date)&&<Hint>This account opened after the schedule began. Repeating dates will start from the next date shown.</Hint>}
  {kind==='payment'&&<Hint>Record a payment already made. SpentOn does not send money to your card.</Hint>}
  {kind==='transfer'&&<Hint>{destination?.type==='investment'&&selected?.type!=='investment'?'Money moved into investments reduces Available to plan. If it is already set aside, move it back from categories first. ':selected?.type==='investment'&&destination?.type!=='investment'?'Money returned from investments becomes available to plan. ':''}Record a transfer already made. SpentOn does not move money between accounts.</Hint>}
  <details className="tx-options" open={showOptions} onToggle={e=>setShowOptions(e.currentTarget.open)}><summary><span>{existing?'Add a note':'Repeat or add a note'}</span><small>{frequency==='none'?'Optional':frequency.charAt(0).toUpperCase()+frequency.slice(1)}</small></summary><div className="tx-options-fields">
   {!existing&&<Field label="Repeat"><Select aria-label="Repeat transaction" value={frequency} onChange={e=>setFrequency(e.target.value as RepeatInterval)}><option value="none">Does not repeat</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></Select></Field>}
   <Field label="Note (optional)"><input name="note" defaultValue={source?.note} maxLength={500} placeholder="Add a reminder"/></Field>
   {frequency!=='none'&&repeatDate&&<Hint>{scheduled?(schedule?'Next entry: ':'First entry: ')+displayDate(repeatDate):'Next entry: '+displayDate(repeatDate)}. Record each entry in Transactions after it happens.</Hint>}
  </div></details>
  {!scheduled&&<label className="check-label tx-cleared"><input type="checkbox" name="cleared" defaultChecked={existing?.cleared??true}/><span>Cleared in my account<small>Shown as completed by your bank, or paid in cash.</small></span></label>}
  {existing?.kind==='expense'&&<button type="button" className="button secondary" onClick={()=>open({type:'refund',purchase:existing})}>Record linked refund</button>}

 </Form></Modal>;
}

function CashShortfallsDialog({b,t,onClose,open}:Props){
 const gaps=[...b.categories.filter(c=>t.categories[c.id].cash<0).map(c=>({id:c.id,name:c.name,amount:-t.categories[c.id].cash})),...b.accounts.filter(a=>a.type==='credit'&&t.cards[a.id].reserve<0).map(a=>({id:'card:'+a.id,name:a.name+' payment',amount:-t.cards[a.id].reserve}))];
 return <Modal title="Review cash shortfalls" eyebrow="REVIEW YOUR SHORTFALLS" onClose={onClose}><div className="form-body"><div className="cash-review-facts"><div><span>Cash currently in your accounts</span><strong>{money(t.cash,b.currency)}</strong></div><div><span>Cash spending to cover</span><strong>{money(t.cashShortfall,b.currency)}</strong></div><div><span>Available before that spending</span><strong>{money(t.unassignedBeforeShortfalls,b.currency)}</strong></div><div><span>Available to plan</span><strong className={t.ready<0?'negative':''}>{money(t.ready,b.currency)}</strong></div></div><p className="muted">Set category money aside to cover past spending. This does not spend money again.</p>{gaps.map(g=>{const amount=Math.min(g.amount,allocationCapacity(t,'ready',g.id));const source=amount>0?'ready':b.categories.find(c=>t.categories[c.id].cash>0)?.id;return <div className="cash-gap-row" key={g.id}><div><strong>{g.name}</strong><small>{money(g.amount,b.currency)} still needs covering</small></div><button className="button secondary" disabled={!source} onClick={()=>open({type:'allocation',from:source,to:g.id,amount:amount||undefined})}>{amount>0?'Cover this spending':'Move category money'}</button></div>;})}{t.ready<0&&<Hint>{t.cash<0?'You have spent more than you have.':'Your spending or category amounts need more cash.'} The shortfall is {money(-t.ready,b.currency)}. Review negative account balances, correct any missing or incorrect records, or release cash from other funded categories.</Hint>}<button className="button secondary" onClick={()=>open({type:'allocation',from:b.categories.find(c=>t.categories[c.id].cash>0)?.id,to:'ready'})}>Review category amounts<ArrowRight size={15}/></button></div></Modal>;
}

function AllocationDialog({dialog,b,t,month,onClose,commit}:Props){
 const initial=dialog.type==='allocation'?dialog:undefined;
 const [from,setFrom]=useState(initial?.from??'ready');
 const [to,setTo]=useState(initial?.to??(initial?.from&&initial.from!=='ready'?'ready':b.categories[0]?.id??'ready'));
 const [amountText,setAmountText]=useState(initial?.amount?String(initial.amount/100):'');
 let moving=0;try{moving=Math.max(0,cents(amountText||'0'));}catch{/* Keep incomplete amounts editable. */}
 const options=[{id:'ready',name:'Available to plan'},...b.categories.map(c=>({id:c.id,name:c.name})),...b.accounts.filter(a=>a.type==='credit').map(a=>({id:'card:'+a.id,name:a.name+' · cash set aside'}))];
 const destination=options.find(o=>o.id===to&&o.id!==from)?.id??options.find(o=>o.id!==from)?.id??'';
 return <Modal title="Move category money" eyebrow="UPDATE YOUR PLAN" onClose={onClose}><Form onClose={onClose} label="Move category money" onSubmit={f=>{
  commit(allocate(b,from,destination,positive(read(f,'amount')),dateFor(month)),'Category amounts updated.');onClose();
 }}>
  <Field label="From"><Select value={from} onChange={e=>setFrom(e.target.value)} aria-label="Move category money from">{options.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</Select></Field>
  <div className="allocation-source"><span>{from==='ready'&&destination!=='ready'&&bucketAvailable(t,destination)<0?'Available to cover this shortfall':'Available to move'}</span><strong>{money(allocationCapacity(t,from,destination),b.currency)}</strong></div>
  <Field label="To"><Select value={destination} onChange={e=>setTo(e.target.value)} aria-label="Move category money to">{options.filter(o=>o.id!==from).map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</Select></Field>
  <Field label="Amount"><div className="amount-input large"><span>{b.currency}</span><AmountInput name="amount" aria-label="Allocation amount" inputMode="decimal" value={amountText} onChange={e=>setAmountText(e.target.value)} placeholder="0.00" required autoFocus/></div></Field>
  {moving>0&&<div className="allocation-preview" role="status"><p>{money(moving,b.currency)} will move from {options.find(o=>o.id===from)?.name} to {options.find(o=>o.id===destination)?.name}. Account balances stay the same.</p>{t.categories[from]&&t.categories[from].assigned-moving<0&&<p>You are moving money carried over from an earlier month. Set aside will show {money(t.categories[from].assigned-moving,b.currency)} because you moved out more than you added this month.</p>}</div>}
  <Hint>{from==='ready'&&destination!=='ready'&&bucketAvailable(t,destination)<0?'This covers cash already spent. Available to plan already reflects that spending, so it is not deducted again.':destination==='ready'?'This returns money to Available to plan. Your account balances stay the same.':destination.startsWith('card:')?'This sets cash aside for repayment. It does not pay the card.':'Money first covers this category’s card purchases that still need cash, setting it aside for repayment.'}</Hint>
 </Form></Modal>;
}

function ResetBudgetDialog({b,onClose,commit}:Props){
 const [mode,setMode]=useState<'factory'|'structure'>('structure');
 return <Modal title="Reset budget" eyebrow={b.name} onClose={onClose}><Form onClose={onClose} label="Reset this budget" submitTone="danger" onSubmit={()=>{commit(resetBudget(b,mode),'Budget reset. All amounts start at zero.');onClose();}}>
  <Field label="Reset option"><Select value={mode} onChange={event=>setMode(event.target.value as typeof mode)}><option value="structure">Keep my accounts and categories</option><option value="factory">Restore default settings</option></Select></Field>
  <p>{mode==='structure'?'Keep account names, account types, categories, subcategories, icons and colors.':'Remove your accounts and categories, and restore the default budget name and starter categories. Your currency stays the same.'}</p>
  <Hint>Both options clear all balances, transactions, category amounts, goals, card statements, schedules and reconciliations in this budget.</Hint>
  <button type="button" className="button secondary" onClick={()=>exportBudget(b)}><Download size={16}/>Download a backup first</button>
  <label className="check-label"><input type="checkbox" required/><span>I understand what will be cleared from this budget.</span></label>
 </Form></Modal>;
}
