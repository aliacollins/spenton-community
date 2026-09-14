import NumberInput from './NumberInput';
import {useConfirmation} from './Confirmation';
import LoadingState from './LoadingState';
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Check,CheckCircle2,Clock3,Plus,Repeat2,Users,ChevronRight,Equal,Percent,Hash} from 'lucide-react';
import {api} from './cloud';
import type {CloudBudget} from './cloud';
import {cents,money,today} from './engine';
import {planGroupBill,billOccurrence} from './group-bill-plan';
import type {BillPlan,SplitMethod} from './group-bill-plan';
import {previewGroupBill} from './group-bill-preview';
import type {CombinedBill,GroupBillSeries,GroupDetail} from './group-types';
import {Field,Modal} from './ui';
import {PersonAvatar} from './PeopleOverview';
import Select from './Select';
import DatePicker from './DatePicker';
import {useSharingFormDraft} from './sharing-drafts';
import type {useSharedRequest} from './useSharedRequest';

type Request=ReturnType<typeof useSharedRequest>;
export const splitMethods:Record<SplitMethod,string>={equal:'Equally',amount:'By amount',percent:'By percentage',shares:'By shares'};
export const billDraftKey=(groupId:string,series?:GroupBillSeries,recurring=false)=>series?'group-series-'+series.id:(recurring?'group-recurring-':'group-bill-')+groupId;
export function GroupBillComposer({group,snapshot,request,series,recurring=false,onBill,onDone,onCancel}:{group:GroupDetail;snapshot:CloudBudget;request:Request;series?:GroupBillSeries;recurring?:boolean;onBill:(bill:CombinedBill)=>void;onDone:()=>void;onCancel:()=>void}){
 const b=snapshot.budget;
 const [amount,setAmount]=useState(series?String(series.definition.total/100):''),[merchant,setMerchant]=useState(series?.merchant??''),[date,setDate]=useState(series?.nextDate??today());
 const [method,setMethod]=useState<SplitMethod>(series?.definition.method??'equal'),[multiple,setMultiple]=useState(!!series&&(series.definition.payers.length!==1||series.definition.payers[0].memberId!==group.memberId));
 const [account,setAccount]=useState(b.accounts.find(a=>a.type==='checking')?.id??b.accounts.find(a=>a.type!=='investment')?.id??''),[category,setCategory]=useState(b.categories.find(c=>c.icon===(group.kind==='trip'?'plane':'basket'))?.id??b.categories[0]?.id??'');
 const [people,setPeople]=useState(group.members.filter(m=>m.state!=='removed').map(m=>({...m,included:series?series.definition.people.some(p=>p.memberId===m.id):true,value:series?.definition.people.find(p=>p.memberId===m.id)?.value??'1',paid:String((series?.definition.payers.find(p=>p.memberId===m.id)?.amount??0)/100)})));
 const [repeat,setRepeat]=useState(!!series||recurring),[interval,setInterval]=useState<'week'|'month'|'year'>(series?.schedule.interval??'month'),[every,setEvery]=useState(String(series?.schedule.every??1)),[until,setUntil]=useState(series?.schedule.until??'');
 const [panel,setPanel]=useState<'payers'|'split'|'repeat'|null>(null);
 const backup=useRef<{people:typeof people;method:SplitMethod;multiple:boolean;repeat:boolean;interval:typeof interval;every:string;until:string}|null>(null);
 const saved=useSharingFormDraft(request.scope,billDraftKey(group.id,series,recurring),snapshot.revision,{amount,merchant,date,method,multiple:String(multiple),account,category,repeat:String(repeat),interval,every,until,people:JSON.stringify(people.map(({id,included,value,paid})=>({id,included,value,paid}))),context:JSON.stringify(group.members.map(m=>[m.id,m.state]))},value=>{
  setAmount(value.amount??'');setMerchant(value.merchant??'');setDate(value.date??today());if(value.method in splitMethods)setMethod(value.method as SplitMethod);setMultiple(value.multiple==='true');setAccount(b.accounts.some(a=>a.id===value.account)?value.account:'');setCategory(b.categories.some(c=>c.id===value.category)?value.category:'');setRepeat(!!series||value.repeat==='true');if(['week','month','year'].includes(value.interval))setInterval(value.interval as typeof interval);setEvery(value.every??'1');setUntil(value.until??'');
  try{const rows=JSON.parse(value.people??'[]');if(Array.isArray(rows))setPeople(current=>current.map(p=>{const old=rows.find(r=>r.id===p.id);return {...p,included:old?.included===true,value:typeof old?.value==='string'?old.value:'1',paid:typeof old?.paid==='string'?old.paid:'0'};}));}catch{/* Keep the current roster. */}
 });
 const chosen=people.filter(p=>p.included),fmt=(n:number)=>money(n,group.currency);
 let total=0,plan:BillPlan|null=null,preview:ReturnType<typeof previewGroupBill>=null,problem='';
 try{total=cents(amount);plan=planGroupBill({total,method,people:chosen.map(p=>({memberId:p.id,value:p.value})),payers:multiple?people.filter(p=>p.state==='active'&&p.paid.trim()&&cents(p.paid)>0).map(p=>({memberId:p.id,amount:cents(p.paid)})):[{memberId:group.memberId,amount:total}]});if(!repeat)preview=previewGroupBill(b,plan,group.memberId,account,category,date,merchant);}catch(error){if(amount)problem=error instanceof Error?error.message:'Check the amounts.';}
 const mePays=!!plan?.payers.some(p=>p.memberId===group.memberId);
 function changeMethod(next:SplitMethod){
  if(next===method)return;setMethod(next);let equalParts:BillPlan|null=null;try{equalParts=planGroupBill({total:next==='percent'?10000:total,method:'equal',people:chosen.map(p=>({memberId:p.id,value:'1'})),payers:[{memberId:group.memberId,amount:next==='percent'?10000:total}]});}catch{/* Incomplete total stays editable. */}
  setPeople(rows=>rows.map(p=>({...p,value:next==='shares'?'1':String((equalParts?.people.find(a=>a.memberId===p.id)?.amount??0)/100)})));
 }
 function submit(){
  if(!plan||!merchant.trim()||(!repeat&&mePays&&!preview)){request.setError(problem||'Complete the bill and your payment details.');return;}
  if(new Set([...plan.people.map(p=>p.memberId),...plan.payers.map(p=>p.memberId)]).size<2){request.setError('Include another person to share this bill, or save a regular transaction.');return;}
  const definition={total:plan.total,method:plan.method,people:plan.people.map(({memberId,value})=>({memberId,value})),payers:plan.payers.map(({memberId,amount})=>({memberId,amount}))};
  const body={...definition,billVersion:1,groupId:group.id,expectedGroupRevision:group.revision,merchant,date};
  if(repeat){
   const schedule={start:date,interval,every:Number(every),...(until?{until}:{})};
   try{billOccurrence(schedule,0);}catch(error){request.setError(error instanceof Error?error.message:'Check the schedule.');return;}
   request.perform(series?'/group-bill-series/'+series.id:'/group-bill-series',{...body,schedule,...(series?{actionType:'edit',expectedSeriesRevision:series.revision}:{})},()=>{saved.clear();onDone();});
  }else request.perform<{bill:CombinedBill}>('/group-bills',{...body,expectedRevision:snapshot.revision,accountId:account,categoryId:category,confirmPaid:mePays},result=>{saved.clear();if(result.bill.state==='recorded')onDone();else onBill(result.bill);});
 }
 const cancel=()=>{saved.clear();onCancel();};
 function openPanel(next:'payers'|'split'|'repeat'){
  backup.current={people,method,multiple,repeat,interval,every,until};
  if(next==='payers'&&!multiple){setPeople(rows=>rows.map(p=>({...p,paid:p.isYou?amount||'0':'0'})));setMultiple(true);}
  setPanel(next);
 }
 function cancelPanel(){const old=backup.current;if(old){setPeople(old.people);setMethod(old.method);setMultiple(old.multiple);setRepeat(old.repeat);setInterval(old.interval);setEvery(old.every);setUntil(old.until);}backup.current=null;setPanel(null);}
 let selection:BillPlan|null=null,paymentTotal:number|null=null;
 try{selection=planGroupBill({total,method,people:chosen.map(p=>({memberId:p.id,value:p.value})),payers:[{memberId:group.memberId,amount:total}]});}catch{/* Incomplete allocations stay editable. */}
 try{paymentTotal=people.filter(p=>p.state==='active').reduce((n,p)=>n+(p.paid.trim()?cents(p.paid):0),0);}catch{/* Show the allocation prompt. */}
 const paymentNames=multiple?people.filter(p=>Number(p.paid)>0).map(p=>p.isYou?'You':p.name):['You'];
 const payerLabel=paymentNames.length>2?paymentNames.length+' people':paymentNames.join(' + ')||'Choose payers';
 const repeatLabel=!repeat?'Doesn’t repeat':every==='1'?({week:'Weekly',month:'Monthly',year:'Yearly'}[interval]):`Every ${every} ${interval}s`;
 let canApply=panel==='payers'?total>0&&paymentTotal===total:panel==='split'?!!selection||!amount&&chosen.length>0:true,status='';
 if(panel==='repeat'){try{if(repeat)billOccurrence({start:date,interval,every:Number(every),...(until?{until}:{})},0);status=repeat?repeatLabel:'One expense';}catch(error){canApply=false;status=error instanceof Error?error.message:'Check the schedule.';}}
 else if(panel==='split'&&method==='equal')status=chosen.length+' people · '+fmt(total);
 else if(panel==='split'&&method==='shares')status=selection?'All '+fmt(total)+' allocated':'Enter a positive number of shares.';
 else{
  let used=paymentTotal;try{if(panel==='split')used=chosen.reduce((n,p)=>n+cents(p.value||'0'),0);}catch{used=null;}
  const target=panel==='split'&&method==='percent'?10000:total,format=(n:number)=>panel==='split'&&method==='percent'?(n/100).toLocaleString()+'%':fmt(n);
  status=used===null?'Check the amounts.':used===target?'All '+format(target)+' allocated':used<target?format(target-used)+' left to allocate':format(used-target)+' over the total';
 }
 function applyPanel(){if(!canApply)return;if(panel==='payers'){const payers=people.filter(p=>p.state==='active'&&Number(p.paid)>0);setMultiple(payers.length!==1||!payers[0]?.isYou);}backup.current=null;setPanel(null);}
 const routing=(label:string,value:string,target:'payers'|'split'|'repeat',Icon:typeof Users)=><button type="button" className="group-setting-row" onClick={()=>openPanel(target)}><Icon aria-hidden="true"/><span><small>{label}</small><strong>{value}</strong></span><ChevronRight aria-hidden="true"/></button>;
 return <>
 <form className="group-form group-bill-composer" onSubmit={e=>{e.preventDefault();submit();}}>{saved.notice}<fieldset disabled={request.busy||!!request.pending}>
  <div className="group-entry-hero"><span>{group.name}</span><Field label="What was it for?"><input autoFocus required maxLength={160} value={merchant} onChange={e=>setMerchant(e.target.value)} placeholder="Dinner, rent, train tickets…"/></Field><div className="group-entry-amount"><span>{group.currency}</span><Field label="Bill amount"><input required inputMode="decimal" value={amount} onFocus={e=>e.target.select()} onChange={e=>setAmount(e.target.value)} placeholder="0.00"/></Field></div></div>
  <div className="group-entry-routing">{routing('Paid by',payerLabel,'payers',Users)}{routing('Split',chosen.length===1?'All for '+(chosen[0].isYou?'you':chosen[0].name):splitMethods[method]+' · '+chosen.length+' people','split',Equal)}</div>
  {!repeat&&mePays&&<section className="group-entry-budget"><div className="group-personal-cost"><span>Your share</span><strong>{preview?fmt(preview.personalSpending):'Check the split'}</strong></div>{multiple&&preview&&<p className="group-note">You paid {fmt(preview.paid)}.</p>}<div className="field-row"><Field label="Paid from"><Select required value={account} onChange={e=>setAccount(e.target.value)}>{b.accounts.filter(a=>a.type!=='investment').map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field><Field label="Your category"><Select required value={category} onChange={e=>setCategory(e.target.value)}>{b.categories.map(c=><option key={c.id} value={c.id}>{c.name} · {c.group}</option>)}</Select></Field></div>{preview&&<details className="group-review-details"><summary>See budget changes</summary><div className="group-own-impact"><dl><div><dt>You paid</dt><dd>{fmt(preview.paid)}</dd></div><div><dt>Left in your category</dt><dd>{fmt(preview.categoryLeft)}</dd></div><div><dt>Available to plan</dt><dd>{fmt(preview.ready)}</dd></div></dl></div></details>}</section>}
  <div className="group-entry-when"><Field label={repeat?'Next bill date':'Purchase date'}><DatePicker required value={date} onChange={setDate} max={repeat?undefined:today()}/></Field>{routing('Repeat',repeatLabel,'repeat',Repeat2)}</div>
  {repeat&&<p className="group-note">Review each occurrence when paid. The schedule does not change your budget.</p>}
  {problem&&<p className="form-error" role="status">{problem}</p>}
  <div className="button-row group-review-footer"><button type="submit" className="button primary" disabled={!plan||(!repeat&&mePays&&!preview)||saved.needsReview}><Check aria-hidden="true"/>{repeat?(series?'Save future bills':'Save recurring bill'):multiple?(mePays?'Confirm my payment':'Request confirmations'):'Save purchase and split'}</button><button type="button" className="button ghost" onClick={cancel}>Cancel</button></div>
 </fieldset></form>
 {panel&&<Modal title={panel==='payers'?'Who paid?':panel==='split'?'Split the expense':'Repeat expense'} className="group-dialog group-entry-options" onClose={cancelPanel}><div className="form-body group-form">
  {panel==='payers'?<><p className="group-note">Enter each person’s actual contribution to this bill.</p><div className="group-plan-rows">{people.map(p=><div key={p.id}><span className="group-person-label"><PersonAvatar name={p.name} identity={p.id}/><span>{p.name}{p.isYou?' (you)':''}{p.state!=='active'&&<small>Invite this person to join first.</small>}</span></span><input aria-label={'Paid by '+p.name} disabled={p.state!=='active'} inputMode="decimal" value={p.paid} onFocus={e=>e.target.select()} onChange={e=>setPeople(rows=>rows.map(row=>row.id===p.id?{...row,paid:e.target.value}:row))}/></div>)}</div></>:panel==='split'?<>
   <div className="group-split-methods" aria-label="How to split">{([['equal','Equal',Equal],['amount','Amounts',Hash],['percent','Percentages',Percent],['shares','Shares',Users]] as const).map(([key,label,Icon])=><button type="button" key={key} aria-pressed={method===key} onClick={()=>changeMethod(key)}><Icon aria-hidden="true"/>{label}</button>)}</div>
   <div className="group-plan-rows">{people.map(p=><div key={p.id}><label className="shared-check group-person-label"><input type="checkbox" checked={p.included} aria-label={'Include '+p.name} onChange={e=>setPeople(rows=>rows.map(row=>row.id===p.id?{...row,included:e.target.checked}:row))}/><PersonAvatar name={p.name} identity={p.id}/>{p.name}{p.isYou?' (you)':''}</label>{p.included&&(method==='equal'?<strong>{selection?fmt(selection.people.find(a=>a.memberId===p.id)!.amount):'Not set'}</strong>:<div className="group-share-input"><input aria-label={(method==='percent'?'Percentage for ':method==='shares'?'Share units for ':'Amount for ')+p.name} inputMode="decimal" value={p.value} onFocus={e=>e.target.select()} onChange={e=>setPeople(rows=>rows.map(row=>row.id===p.id?{...row,value:e.target.value}:row))}/>{method==='percent'&&<span>%</span>}{selection&&<small>{fmt(selection.people.find(a=>a.memberId===p.id)!.amount)}</small>}</div>)}</div>)}</div>
   {method==='shares'&&<p className="group-note">Use nights, portions or people as share units. 2 shares cost twice as much as 1.</p>}
  </>:<>{!series&&<label className="shared-check"><input type="checkbox" checked={repeat} onChange={e=>setRepeat(e.target.checked)}/>Repeat this bill</label>}{repeat&&<><div className="field-row"><Field label="Repeat every"><NumberInput label="Repeat every" min="1" max="12" required value={every} onChange={e=>setEvery(e.target.value)}/></Field><Field label="Interval"><Select value={interval} onChange={e=>setInterval(e.target.value as typeof interval)}><option value="week">Weeks</option><option value="month">Months</option><option value="year">Years</option></Select></Field></div><Field label="End date (optional)"><DatePicker value={until} onChange={setUntil}/></Field></>}<p className="group-note">Upcoming occurrences wait for review. No money is recorded automatically.</p></>}
  <div className="group-panel-footer"><p role="status" className={canApply?'':'form-error'}>{status}</p><div className="button-row"><button type="button" className="button ghost" onClick={cancelPanel}>Cancel</button><button type="button" className="button primary" disabled={!canApply} onClick={applyPanel}><Check aria-hidden="true"/>{panel==='payers'?'Apply payers':panel==='split'?'Apply split':'Apply repeat'}</button></div></div>
 </div></Modal>}
 </>;
}

export function GroupBillReview({id,snapshot,request,onDone,onExpense}:{id:string;snapshot:CloudBudget;request:Request;onDone:()=>void;onExpense:(id:string)=>void}){
 const [bill,setBill]=useState<CombinedBill|null>(null),[account,setAccount]=useState(''),[category,setCategory]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false),sequence=useRef(0),loadingRef=useRef(false);
 const saved=useSharingFormDraft(request.scope,'group-bill-review-'+id,snapshot.revision,{account,category},fields=>{setAccount(fields.account??'');setCategory(fields.category??'');},!!account||!!category);
 async function load(clearError=false){
  if(clearError)setError('');
  const seq=++sequence.current;loadingRef.current=true;setLoading(true);
  try{const next=await api<CombinedBill>('/group-bills/'+id+(account&&category?'/preview':''),account&&category?{method:'POST',body:{accountId:account,categoryId:category}}:undefined);if(seq!==sequence.current)return;setBill(next);setError('');if(!account&&next.own)setAccount(next.own.accountId);if(!category&&next.own)setCategory(next.own.categoryId);}
  catch(error){if(seq===sequence.current)setError(error instanceof Error?error.message:'The bill could not be loaded.');}finally{if(seq===sequence.current){loadingRef.current=false;setLoading(false);}}
 }
 useEffect(()=>{void load();const timer=setInterval(()=>{if(!document.hidden&&!request.pending&&!request.busy&&!loadingRef.current)void load();},5000);return()=>{sequence.current++;clearInterval(timer);};},[id,account,category,request.pending,request.busy]);
 if(!bill)return error?<><p role="alert">{error}</p><button className="button secondary" onClick={()=>void load(true)}>Try again</button></>:<LoadingState label="Loading this bill"/>;
 const fmt=(n:number)=>money(n,bill.currency),canAct=(bill.canConfirm||bill.canAccept)&&bill.own?.budgetId===snapshot.id&&!bill.problem;
 function confirm(){request.perform<{bill:CombinedBill}>('/group-bills/'+id+(bill!.canConfirm?'/confirm':'/accept'),{billVersion:1,expectedBillRevision:bill!.revision,expectedRevision:bill!.own!.revision,accountId:account,categoryId:category,confirmPaid:bill!.canConfirm,confirmShare:bill!.canAccept},result=>setBill(result.bill));}
 return <div className="group-review">
  {saved.notice}<div className="group-review-status">{bill.state==='recorded'?<CheckCircle2/>:<Clock3/>}<strong>{bill.state==='recorded'?'Bill recorded':bill.state==='cancelled'?'Bill cancelled':'Waiting for payer confirmations'}</strong></div>
  <div className="group-review-amount"><strong>{fmt(bill.total)}</strong><span>{bill.merchant} · {bill.date}</span></div>
  {bill.scheduledDate&&bill.scheduledDate!==bill.date&&<p className="group-note">Scheduled for {bill.scheduledDate}.</p>}{bill.refunded>0&&<p className="group-note">{fmt(bill.refunded)} refunded.</p>}
  <section className="group-bill-section"><h3>Who paid</h3><div className="group-plan-rows">{bill.payers.map(p=><div key={p.memberId}><span>{p.name}{p.isYou?' (you)':''}<small>{p.approved?(bill.state==='recorded'?'Recorded':'Confirmed'):'Confirmation needed'}</small></span><strong>{fmt(p.amount)}</strong></div>)}</div></section>
  <section className="group-bill-section"><h3>Everyone’s share</h3><div className="group-plan-rows">{bill.people.map(p=><div key={p.memberId}><span>{p.name}{p.isYou?' (you)':''}</span><strong>{fmt(p.amount)}</strong></div>)}</div></section>
  {(bill.canConfirm||bill.canAccept)&&bill.budgetId===snapshot.id&&<fieldset disabled={request.busy||!!request.pending||saved.needsReview}><div className="field-row">{bill.canConfirm&&<Field label="Paid from"><Select value={account} onChange={e=>setAccount(e.target.value)}>{snapshot.budget.accounts.filter(a=>a.type!=='investment').map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>}<Field label="Your category"><Select value={category} onChange={e=>setCategory(e.target.value)}>{snapshot.budget.categories.map(c=><option key={c.id} value={c.id}>{c.name} · {c.group}</option>)}</Select></Field></div></fieldset>}
  {bill.own&&<details className="group-review-details" open={bill.canAccept}><summary>Your budget changes</summary><div className="group-own-impact"><dl>{([['cash','Cash in accounts'],['spent','Spending this month'],['ready','Available to plan'],['receivable','Friends owe you'],['owed','You owe']] as const).filter(([key])=>bill.own!.before[key]!==bill.own!.after[key]).map(([key,label])=><div key={key}><dt>{label}</dt><dd><span>{fmt(bill.own!.before[key])}</span><ArrowRight/><strong>{fmt(bill.own!.after[key])}</strong></dd></div>)}</dl></div></details>}
  {bill.state==='pending'&&<p className="group-note">Every payer confirms their own payment and share. Budgets change together after all payers confirm.</p>}
  {bill.state==='recorded'&&<details className="group-review-details"><summary>Payments and corrections</summary><div className="button-row">{bill.payers.filter(p=>p.expenseId&&p.canOpen).map(p=><button className="button secondary" key={p.memberId} disabled={!request.canClose()} onClick={()=>onExpense(p.expenseId!)}>Review {p.name}’s payment</button>)}</div></details>}
  {(error||bill.problem)&&<p className="form-error" role="alert">{error||bill.problem}</p>}
  {bill.own&&bill.own.budgetId!==snapshot.id&&<p>Open {bill.own.budgetName} to review your changes.</p>}
  <div className="group-review-footer">{canAct?<button className="button primary" disabled={loading||request.busy||!!request.pending||saved.needsReview} onClick={confirm}><Check/>{bill.canConfirm?'Confirm my payment':'Accept my share'}</button>:<button className="button primary" disabled={!request.canClose()} onClick={onDone}>Close review<ArrowRight/></button>}{(bill.canCancel||bill.canAccept)&&<details className="group-more-actions"><summary>More actions</summary><button disabled={request.busy||!!request.pending} onClick={()=>request.perform<{bill:CombinedBill}>('/group-bills/'+id+(bill.canCancel?'/confirm':'/accept'),{decision:bill.canCancel?'cancel':'decline',expectedBillRevision:bill.revision},result=>setBill(result.bill))}>{bill.canCancel?'Cancel this bill':'Decline my share'}</button></details>}</div>
 </div>;
}

export function GroupBillSections({group,request,onBill,onSchedule,onChanged}:{group:GroupDetail;request:Request;onBill:(id:string)=>void;onSchedule:(series?:GroupBillSeries)=>void;onChanged:()=>void}){
 const confirm=useConfirmation();
 const fmt=(n:number)=>money(n,group.currency);
 function change(series:GroupBillSeries,actionType:string){request.perform<{bill?:CombinedBill}>('/group-bill-series/'+series.id,{expectedSeriesRevision:series.revision,actionType},result=>{if(result.bill)onBill(result.bill.id);onChanged();});}
 return <>{!!group.combinedBills?.length&&<section className="group-reviews-list"><h3>Shared bills</h3>{group.combinedBills.map(bill=><button key={bill.id} disabled={!!request.pending} onClick={()=>onBill(bill.id)}>{bill.state==='recorded'?<CheckCircle2/>:<Clock3/>}<span><strong>{bill.merchant}</strong><small>{bill.state==='pending'?'Payers reviewing':bill.state==='cancelled'?'Cancelled':bill.canAccept?'Your share needs review':'Recorded'} · {bill.scheduledDate??bill.date}</small></span><strong>{fmt(bill.total)}</strong><ArrowRight/></button>)}</section>}
  <section className="group-series-list"><div className="people-section-heading"><h3>Recurring bills</h3>{group.state==='active'&&<button className="text-button" disabled={!!request.pending} onClick={()=>onSchedule()}><Plus size={16}/>Add recurring bill</button>}</div>{!group.series?.length?<p className="group-note">Keep rent, subscriptions and other repeating group costs ready to review.</p>:group.series.map(series=><article key={series.id}><Repeat2 aria-hidden="true"/><div><strong>{series.merchant}</strong><small>{series.state==='complete'?'Ended':series.state==='paused'?'Paused':(series.due?'Due ':'Next ')+series.nextDate} · {fmt(series.definition.total)}</small></div>{series.due&&group.state==='active'&&<button className="button primary" disabled={!!request.pending} onClick={()=>change(series,'create-occurrence')}>Review due bill</button>}{series.canManage&&series.state!=='complete'&&group.state==='active'&&<details><summary>Manage</summary><div className="button-row"><button className="button secondary" disabled={!!request.pending} onClick={()=>onSchedule(series)}>Edit future bills</button><button className="button secondary" disabled={!!request.pending} onClick={()=>change(series,series.state==='paused'?'resume':'pause')}>{series.state==='paused'?'Resume':'Pause'}</button><button className="button secondary" disabled={!!request.pending} onClick={async()=>{if(await confirm({title:'Skip the next bill?',description:series.merchant+' · '+series.nextDate+'. No bill or budget entry will be created for this occurrence.',confirmLabel:'Skip next bill'}))change(series,'skip');}}>Skip next bill</button><button className="button ghost" disabled={!!request.pending} onClick={async()=>{if(await confirm({title:'End this schedule?',description:series.merchant+'. Future bills will stop. Recorded bills and history stay available.',confirmLabel:'End schedule',destructive:true}))change(series,'end');}}>End schedule</button></div></details>}</article>)}</section>
 </>;
}
