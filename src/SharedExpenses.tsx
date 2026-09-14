import LoadingState from './LoadingState';
import {useConfirmation} from './Confirmation';
import {BillPages} from './ShareInvitation';
import type {SharedBill} from './ShareInvitation';
import {useEffect,useRef,useState} from 'react';
import type {RefObject} from 'react';
import {api,CloudError,validateSnapshot,getBudget} from './cloud';
import type {BudgetSummary,CloudBudget} from './cloud';
import {cents,money,today,calculate} from './engine';
import {Field,Modal} from './ui';
import './shared-expenses.css';
import Select from './Select';
import DatePicker from './DatePicker';
import {previewSharedBudget} from './shared-budget';
import {planGroupBill} from './group-bill-plan';
import type {SplitMethod} from './group-bill-plan';
import {ArrowRight,Plus,CheckCircle2,X} from 'lucide-react';
import PeopleOverview,{personKey,personName} from './PeopleOverview';
import SharedExpenseCard from './SharedExpenseCard';
import PeopleReviewQueue from './PeopleReviewQueue';
import {matchingShares,paymentPriority} from './people-presentation';
import type {PeopleAction} from './people-presentation';
import type {PersonBalance,PeopleFilter,PeopleView} from './PeopleOverview';
import ExpenseGroups from './ExpenseGroups';
import {useSharedRequest} from './useSharedRequest';
import {SharedChangeComposer,changeDraftKey} from './SharedChangeReview';
import type {ChangeDraft} from './SharedChangeReview';
import type {SharedChange} from './group-types';
import {sharingScope,pendingSharingRequest,writeSharingDraft,removeSharingDraft} from './sharing-drafts';

export type Settlement={id:string;amount:number;state:string;date:string;recordedByPayer?:boolean;recordedInYourBudget?:boolean};
export type Share={reviewPending?:boolean;pendingChangeId?:string;offset?:number;refunded?:number;originalAmount?:number;categoryId?:string|null;id:string;email:string;name?:string;personKey?:string;amount:number;state:string;budgetId:string|null;confirmed:number;pending:number;settlements:Settlement[]};
export type Expense={groupName?:string;combinedBillId?:string;groupId?:string|null;groupBudgetId?:string|null;kind?:string;refunded?:number;expenseRevision?:number;ledgerVersion?:number;id:string;hasReceipt?:boolean;owned:boolean;merchant:string;total:number;currency:string;date:string;payer:string;entryId:string|null;budgetId:string|null;shares:Share[]};
type Inbox={groupVersion?:number;verificationRequired:boolean;expenses:Expense[];balances?:PersonBalance[];hasMore?:boolean;nextOffset?:number|null};
export type Payment={expense:Expense;share:Share;settlement?:Settlement;receiveOffline?:boolean;importReceived?:boolean};
type Draft={path:string;body:Record<string,unknown>};

export default function SharedExpenses({initial,onSaved,onClose,onWorkspace,navigationGuard,userId}:{userId:string;initial:CloudBudget;onSaved:(value:CloudBudget)=>void;onClose:()=>void;onWorkspace:()=>void;navigationGuard:RefObject<(()=>boolean)|null>}){
 const confirm=useConfirmation();
 const draftScope=sharingScope(userId,initial.id);
 const restoredGroup=pendingSharingRequest(draftScope,'groups'),restoredPeople=pendingSharingRequest(draftScope,'people');
 const [section,setSection]=useState<'people'|'groups'>(new URLSearchParams(location.search).has('groups')||restoredGroup?'groups':'people'),[selectedGroup,setSelectedGroup]=useState(typeof restoredGroup?.body.groupId==='string'?restoredGroup.body.groupId:''),[groupContext,setGroupContext]=useState<{id:string;expenseId:string}|null>(null),[reviewId,setReviewId]=useState(''),[changeDraft,setChangeDraft]=useState<ChangeDraft|null>(null);
 const externalPending=useRef(false);
 const [snapshot,setSnapshot]=useState(initial),[inbox,setInbox]=useState<Inbox|null>(null),[creating,setCreating]=useState(false),[payment,setPayment]=useState<Payment|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[failed,setFailed]=useState<CloudError|null>(null),[draft,setDraft]=useState<Draft|null>(restoredPeople);
 const [accepting,setAccepting]=useState<{expense:Expense;share:Share}|null>(null),[categoryId,setCategoryId]=useState('');
 const [personFilter,setPersonFilter]=useState(''),[personSearch,setPersonSearch]=useState(''),[peopleFilter,setPeopleFilter]=useState<PeopleFilter>('all'),[peopleCurrency,setPeopleCurrency]=useState(''),[notice,setNotice]=useState('');
 const [peopleView,setPeopleView]=useState<PeopleView>('people'),[expandedBill,setExpandedBill]=useState(''),[reviewsExpanded,setReviewsExpanded]=useState(false);
 const actionFocus=useRef<{controlId:string;expenseId:string}|null>(null);
 const [entryId,setEntryId]=useState(''),[splitMethod,setSplitMethod]=useState<SplitMethod>('equal'),[ownWeight,setOwnWeight]=useState('1'),[people,setPeople]=useState([{name:'',email:'',amount:'',personKey:crypto.randomUUID()}]);
 const equal=splitMethod==='equal';
 const [navBusy,setNavBusy]=useState(false),[historyLoading,setHistoryLoading]=useState(false);
 const snapshotRef=useRef(snapshot);snapshotRef.current=snapshot;
 const [loadError,setLoadError]=useState(''),[loadedPerson,setLoadedPerson]=useState(''),[loadedGroup,setLoadedGroup]=useState('');
 const [billLoading,setBillLoading]=useState(false),billRead=useRef(0);
 const [invitation,setInvitation]=useState<{text:string;url:string}|null>(null),[inviteCopied,setInviteCopied]=useState(false),[bill,setBill]=useState<SharedBill|null>(null);
 const loadSequence=useRef(0),currentInbox=useRef(inbox);currentInbox.current=inbox;
 const pending=useRef<Draft|null>(restoredPeople),mounted=useRef(true),submitting=useRef(false);
 useEffect(()=>{navigationGuard.current=()=>{if(pending.current||submitting.current||externalPending.current){setError('Resolve the pending request before leaving People.');return false;}return true;};return()=>{navigationGuard.current=null;};},[navigationGuard]);
 const acceptSnapshot=(next:CloudBudget)=>{if(mounted.current&&next.id===snapshotRef.current.id&&next.revision>snapshotRef.current.revision){snapshotRef.current=next;setSnapshot(next);onSaved(next);}};
 const groupRequest=useSharedRequest(snapshot,acceptSnapshot,externalPending,draftScope,'changes');
 useEffect(()=>{if(groupRequest.recovered?.change){setReviewId(groupRequest.recovered.change.id);setSelectedGroup(groupRequest.recovered.change.groupId??'');setSection('groups');}},[groupRequest.recovered]);
 const receiving=!!payment&&(!!payment.receiveOffline||!!payment.settlement&&!payment.importReceived);
 const [budgetNames,setBudgetNames]=useState<Record<string,string>>({});
 const paymentBudgetId=payment?(receiving?payment.expense.budgetId:payment.share.budgetId):null;
 const paymentNeedsBudget=!!payment&&paymentBudgetId!==snapshot.id;
 useEffect(()=>{
  if(!paymentBudgetId||paymentBudgetId===snapshot.id||budgetNames[paymentBudgetId])return;
  let cancelled=false;
  void api<{budgets:BudgetSummary[]}>('/budgets').then(value=>{if(!cancelled)setBudgetNames(Object.fromEntries(value.budgets.map(budget=>[budget.id,budget.name])));}).catch(()=>{/* The budget list remains reachable if its optional name cannot be loaded. */});
  return()=>{cancelled=true;};
 },[paymentBudgetId,snapshot.id]);
 function closeBill(){billRead.current++;setBillLoading(false);setBill(null);}
 async function openBill(expenseId:string){
  const sequence=++billRead.current;setBill(null);setBillLoading(true);
  try{const value=await api<SharedBill>('/shared-expenses/'+expenseId+'/receipt');if(mounted.current&&sequence===billRead.current)setBill(value);}
  catch(error){if(mounted.current&&sequence===billRead.current)setError(error instanceof Error?error.message:'The bill could not be opened.');}
  finally{if(mounted.current&&sequence===billRead.current)setBillLoading(false);}
 }
 function chooseBudget(){if(pending.current||externalPending.current||busy)return;setPayment(null);setAccepting(null);onWorkspace();}
 const b=snapshot.budget,entry=b.entries.find(e=>e.id===entryId),fmt=(n:number)=>money(n,b.currency);
 async function load(person=personFilter,more=false,groupId=groupContext?.id??'',refreshBudget=false){const sequence=++loadSequence.current;const foreground=!currentInbox.current||more||person!==loadedPerson||groupId!==loadedGroup||refreshBudget;if(foreground){setHistoryLoading(true);setLoadError('');}if(refreshBudget)setNavBusy(true);try{const query=new URLSearchParams({person,group:groupId,offset:String(more?inbox?.nextOffset??0:0)});const [value,latest]=await Promise.all([api<Inbox>('/shared-expenses'+(person||more||groupId?'?'+query:'')),refreshBudget?getBudget(snapshotRef.current.id):Promise.resolve(null)]);if(mounted.current&&sequence===loadSequence.current){if(latest)acceptSnapshot(latest);setLoadError('');setLoadedPerson(person);setLoadedGroup(groupId);setInbox(previous=>more&&previous?{...value,expenses:[...previous.expenses,...value.expenses.filter(e=>!previous.expenses.some(p=>p.id===e.id))]}:value);}}catch(e){if(mounted.current&&sequence===loadSequence.current)setLoadError(e instanceof CloudError&&e.status===404?'Sharing is not available on this version of SpentOn yet. Your budget remains available.':e instanceof Error?e.message:'People could not be loaded.');}finally{if(mounted.current&&sequence===loadSequence.current){setNavBusy(false);setHistoryLoading(false);}}}
 useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;};},[]);
 useEffect(()=>{const timer=setInterval(()=>{if(!document.hidden&&!pending.current&&!creating&&!payment&&!accepting&&!changeDraft&&!navBusy&&!historyLoading&&section==='people'&&!externalPending.current&&(currentInbox.current?.expenses.length??0)<=200)void load();},5000);return()=>clearInterval(timer);},[creating,payment,accepting,personFilter,groupContext,section,changeDraft,navBusy,historyLoading]);
 useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(pending.current||externalPending.current||creating||payment||accepting||changeDraft){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[creating,payment,accepting,personFilter,groupContext,section,changeDraft,navBusy,historyLoading]);
 async function transmit(value:Draft){
  if(submitting.current)return;submitting.current=true;setBusy(true);setError('');setNotice('');setFailed(null);
  try{
   const response=await api<{expense:Expense;snapshot?:CloudBudget;invitation?:{shareId:string;url:string}}>(value.path,{method:'POST',body:value.body});
   if(response.snapshot){const next=validateSnapshot(response.snapshot);if(next.id!==snapshot.id)throw new Error('The response belongs to a different budget. Your draft is kept.');if(next.revision>=snapshot.revision){setSnapshot(next);onSaved(next);}}
   if(response.invitation){setInviteCopied(false);const share=response.expense.shares.find(s=>s.id===response.invitation!.shareId)!;setInvitation({url:response.invitation.url,text:`Hey! I’ve added your ${money(share.amount,response.expense.currency)} share for ${response.expense.merchant} on SpentOn. The bill total is ${money(response.expense.total,response.expense.currency)}. ${share.confirmed>0?`I’ve recorded ${money(share.confirmed,response.expense.currency)} received, leaving ${money(share.amount-share.confirmed,response.expense.currency)} outstanding. `:""}Review your share and join here: ${response.invitation.url}`});}
   setNotice(response.invitation?'Invitation ready. Choose how to send it.':value.path.endsWith('/receive')?'Money received has been recorded.':value.path.endsWith('/repay')?'Repayment recorded. Waiting for the other person to confirm.':value.body.action==='confirm'?'Money received has been recorded. Your budget is updated.':value.body.action==='dispute'?'Repayment marked as not received.':value.body.action==='accept'?'Share accepted.':value.body.action==='cancel'?'Share request cancelled.':'Shared expense saved.');
   pending.current=null;setDraft(null);removeSharingDraft(draftScope,'pending-people');setCreating(false);setPayment(null);setAccepting(null);setEntryId('');setPeople([{name:'',email:'',amount:'',personKey:crypto.randomUUID()}]);await load();
  }catch(e){const problem=e instanceof CloudError?e:new CloudError(0,'SHARE_FAILED',e instanceof Error?e.message:'This change could not be confirmed.');setFailed(problem);setError(problem.message);}
  finally{submitting.current=false;setBusy(false);}
 }
 function send(path:string,body:Record<string,unknown>){if(pending.current||submitting.current)return;const next={path,body:{...body,ledgerVersion:inbox?.groupVersion===1?3:2,operationId:crypto.randomUUID()}};pending.current=next;setDraft(next);writeSharingDraft(draftScope,'pending-people',snapshot.revision,{request:JSON.stringify(next)});void transmit(next);}
 function close(){if(busy)return;if(pending.current){setError('Retry, export or explicitly discard the pending request before closing.');return;}if(creating){setCreating(false);setEntryId('');setPeople([{name:'',email:'',amount:'',personKey:crypto.randomUUID()}]);setSplitMethod('equal');setOwnWeight('1');}else if(payment)setPayment(null);else if(accepting)setAccepting(null);else onClose();}
 async function discard(){const original=pending.current;if(!original||submitting.current)return;if(!await confirm({title:'Discard this local request?',description:'This cannot undo a request already saved on the server. Check People after reloading.',confirmLabel:'Discard request',cancelLabel:'Keep request',destructive:true})||pending.current!==original||submitting.current)return;try{const latest=await getBudget(snapshot.id);setSnapshot(latest);onSaved(latest);pending.current=null;setDraft(null);removeSharingDraft(draftScope,'pending-people');setFailed(null);setError('');setCreating(false);setPayment(null);setAccepting(null);await load();}catch(e){setError(e instanceof Error?e.message:'The saved budget could not be loaded. Your draft is kept.');}}
 function exportDraft(){if(!draft)return;const url=URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='SpentOn-shared-expense-draft.json';a.click();URL.revokeObjectURL(url);}
 async function respond(share:Share,action:string,expense:Expense){if(action==='accept'&&(expense.ledgerVersion??1)>=2){setNotice('');setCategoryId('');setAccepting({expense,share});return;}if(action==='cancel'&&(expense.ledgerVersion??1)>=2){if(expense.budgetId!==snapshot.id){setError('Open the budget that paid for this purchase before cancelling its share.');return;}if(!await confirm({title:'Cancel this request?',description:money(share.amount,expense.currency)+' will become your spending in the original purchase category.',confirmLabel:'Cancel share request',cancelLabel:'Keep request',destructive:true}))return;}send('/expense-shares/'+share.id+'/respond',{action,expectedRevision:snapshot.revision,...(action==='accept'?{budgetId:snapshot.id}:{})});}
 function shareAmounts(){
  if(equal||splitMethod==='amount')return people.map(p=>equal?Math.floor((entry?.amount??0)/(people.length+1)):cents(p.amount));
  const plan=planGroupBill({total:entry?.amount??0,method:splitMethod,people:[{memberId:'self',value:ownWeight},...people.map(p=>({memberId:p.personKey,value:p.amount}))],payers:[{memberId:'self',amount:entry?.amount??0}]});
  return people.map(p=>plan.people.find(a=>a.memberId===p.personKey)!.amount);
 }
 function chooseSplitMethod(method:SplitMethod){
  setSplitMethod(method);if(method==='equal')return;
  if(method==='shares'){setOwnWeight('1');setPeople(rows=>rows.map(p=>({...p,amount:'1'})));return;}
  try{const total=method==='percent'?10000:entry?.amount??0,plan=planGroupBill({total,method:'equal',people:[{memberId:'self',value:'1'},...people.map(p=>({memberId:p.personKey,value:'1'}))],payers:[{memberId:'self',amount:total}]});setOwnWeight(String(plan.people.find(p=>p.memberId==='self')!.amount/100));setPeople(rows=>rows.map(p=>({...p,amount:String(plan.people.find(a=>a.memberId===p.personKey)!.amount/100)})));}catch{setPeople(rows=>rows.map(p=>({...p,amount:''})));}
 }
 function create(){try{if(!entry)throw new Error('Choose a purchase.');const amounts=shareAmounts();if(amounts.some(a=>a<=0)||amounts.reduce((a,c)=>a+c,0)>entry.amount)throw new Error('Shares must be positive and fit within the purchase total.');send('/shared-expenses',{budgetId:snapshot.id,expectedRevision:snapshot.revision,entryId:entry.id,shares:people.map((p,index)=>({email:p.email,name:p.name,personKey:p.personKey,amount:amounts[index]}))});}catch(e){setError(e instanceof Error?e.message:'Check the shares.');}}
 function recordPayment(form:HTMLFormElement){if(!payment)return;try{
  const values=new FormData(form),common={expectedRevision:snapshot.revision,accountId:String(values.get('account')),date:String(values.get('date'))};
  if(payment.importReceived&&payment.settlement)send('/share-settlements/'+payment.settlement.id+'/record',{...common,categoryId:String(values.get('category')),confirmPaid:values.get('confirmed')==='on'});
  else if(payment.receiveOffline)send('/expense-shares/'+payment.share.id+'/receive',{...common,amount:cents(String(values.get('amount'))),confirmReceived:values.get('confirmed')==='on'});
  else if(payment.settlement)send('/share-settlements/'+payment.settlement.id,{...common,action:'confirm',confirmReceived:values.get('confirmed')==='on'});
  else send('/expense-shares/'+payment.share.id+'/repay',{...common,amount:cents(String(values.get('amount'))),categoryId:String(values.get('category')),confirmPaid:values.get('confirmed')==='on'});
 }catch(e){setError(e instanceof Error?e.message:'Check the repayment.');}}
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),6500);return()=>clearTimeout(timer);},[notice]);
 function rememberAction(expenseId:string,controlId?:string){actionFocus.current={controlId:controlId??document.activeElement?.id??'',expenseId};}
 function actOnShare(expense:Expense,share:Share,action:PeopleAction,controlId?:string){
  if(busy||pending.current||externalPending.current||navBusy)return;
  rememberAction(expense.id,controlId);setNotice('');
  if(action.kind==='confirm')setPayment({expense,share,settlement:action.settlement});
  else if(action.kind==='import')setPayment({expense,share,settlement:action.settlement,importReceived:true});
  else if(action.kind==='accept')void respond(share,'accept',expense);
  else if(action.kind==='receive')setPayment({expense,share,receiveOffline:true});
  else if(action.kind==='repay')setPayment({expense,share});
  else if(action.kind==='change'){setReviewId(action.changeId);setSelectedGroup(expense.groupId??'');setSection('groups');}
  else{setPeopleView('bills');setExpandedBill(expense.id);}
 }
 useEffect(()=>{
  if(section==='groups'){actionFocus.current=null;return;}
  if(payment||accepting||creating||changeDraft||invitation||bill||busy||draft||!actionFocus.current)return;
  const target=actionFocus.current;actionFocus.current=null;
  const frame=requestAnimationFrame(()=>{
   const element=document.getElementById(target.controlId)||document.getElementById('bill-toggle-'+target.expenseId)||document.querySelector<HTMLElement>('.people-detail h2')||document.getElementById('people-history-title')||document.getElementById('people-directory-title');
   element?.focus({preventScroll:true});
  });
  return()=>cancelAnimationFrame(frame);
 },[payment,accepting,creating,changeDraft,invitation,bill,busy,draft,peopleView,expandedBill,section]);
 function changePeopleScope(filter:PeopleFilter,currency=peopleCurrency){
  if(pending.current||externalPending.current||navBusy)return;
  setPeopleFilter(filter);setPeopleCurrency(currency);
  if(groupContext?.expenseId)setGroupContext({...groupContext,expenseId:''});
 }
 function clearPeopleScope(){changePeopleScope('all','');requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>('.people-filters [aria-pressed="true"]')?.focus({preventScroll:true}));}
 const visibleExpenses=(inbox?.expenses??[]).filter(expense=>(!groupContext?.expenseId||expense.id===groupContext.expenseId)&&(!peopleCurrency||expense.currency===peopleCurrency)).map(expense=>({expense,shares:matchingShares(expense,personFilter,peopleFilter)})).filter(row=>row.shares.length>0).sort((a,b)=>paymentPriority({...a.expense,shares:a.shares})-paymentPriority({...b.expense,shares:b.shares}));
 const scoped=peopleFilter!=='all'||!!peopleCurrency;
 const sharedTotals=calculate(b,today().slice(0,7)).shared;
 let splitPreview:ReturnType<typeof previewSharedBudget>|null=null,acceptPreview:ReturnType<typeof previewSharedBudget>|null=null;
 try{if(entry)splitPreview=previewSharedBudget(b,{kind:'split',entryId:entry.id,amount:String(shareAmounts().reduce((n,a)=>n+a,0))});}catch{ /* Keep invalid inputs editable. */ }
 try{if(accepting&&categoryId)acceptPreview=previewSharedBudget(b,{kind:'accept',categoryId,amount:String(accepting.share.amount),date:accepting.expense.date});}catch{ /* A valid category is required before acceptance. */ }
 const content=<div className="form-body shared-expenses people-clarity people-simple">
  <div className="people-intro"><div><h1>{section==='groups'?'Groups':'People'}</h1><p>{section==='groups'?'Keep bills for a household, trip or event together.':'See what you owe and what others owe you.'}</p></div>{section==='people'&&!groupContext&&!creating&&!payment&&!accepting&&<button className="button primary" disabled={!inbox||inbox.verificationRequired||busy||!!draft||navBusy} onClick={()=>{setNotice('');setCreating(true);}}><Plus aria-hidden="true"/>Split a purchase</button>}</div>
  {(inbox?.groupVersion===1||section==='groups')&&!creating&&!payment&&!accepting&&<div className="people-sections" aria-label="Shared expense views">{(['people','groups'] as const).map(view=><button key={view} type="button" aria-pressed={section===view} onClick={()=>{if(pending.current||externalPending.current)return;setSection(view);setGroupContext(null);setPersonFilter('');setPeopleFilter('all');setPeopleCurrency('');setPeopleView('people');setExpandedBill('');if(view==='people')void load('',false,'',true);}}>{view==='people'?'People':'Groups'}</button>)}</div>}
  {notice&&<div className="people-feedback" role="status"><CheckCircle2 size={17} aria-hidden="true"/><span>{notice}</span><button type="button" className="icon-button" aria-label="Dismiss sharing confirmation" onClick={()=>setNotice('')}><X size={15}/></button></div>}
  {error&&<p className="form-error" role="alert">{error}</p>}
  {loadError&&<div className="warning-banner" role="alert"><p>{loadError}</p><button type="button" className="button secondary" onClick={()=>void load(personFilter,false,groupContext?.id??'',true)}>Try again</button></div>}
  {!changeDraft&&groupRequest.recovery}
  {draft&&<div className="warning-banner"><p>Keep this page open. Your request is retained for retry or export.</p><div className="button-row"><button className="button secondary" disabled={busy||failed?.code==='REVISION_CONFLICT'||failed?.code==='SHARE_OPERATION_REUSED'} onClick={()=>void transmit(draft)}>Retry original request</button><button className="button secondary" onClick={exportDraft}>Export request</button><button className="button ghost" disabled={busy} onClick={discard}>Discard request</button></div></div>}
  {invitation&&<Modal title="Invitation ready" onClose={()=>{setInvitation(null);setError('');}}><div className="form-body"><p>Review the message, then choose how to send it.</p><blockquote className="sharing-message">{invitation.text}</blockquote><div className="button-row"><a className="button primary" href={'sms:?body='+encodeURIComponent(invitation.text)}>Open Messages</a><button type="button" className="button secondary" onClick={()=>{void navigator.clipboard.writeText(invitation.text).then(()=>setInviteCopied(true)).catch(()=>setError('Select and copy the invitation text.'));}}>{inviteCopied?'Copied':'Copy message'}</button></div>{error&&<p className="form-error" role="alert">{error}</p>}</div><div className="modal-footer"><button type="button" className="button ghost" onClick={()=>{setInvitation(null);setError('');}}>Done</button></div></Modal>}
  {(bill||billLoading)&&<Modal title="Shared bill" onClose={closeBill} wide><div className="form-body">{bill?<BillPages bill={bill}/>:<LoadingState label="Loading the shared bill"/>}</div><div className="modal-footer"><button type="button" className="button primary" onClick={closeBill}>Close bill</button></div></Modal>}
  {section==='groups'?<ExpenseGroups scope={draftScope} snapshot={snapshot} onSaved={acceptSnapshot} blocked={externalPending} selected={selectedGroup} onSelect={setSelectedGroup} initialReview={reviewId} onReviewClosed={()=>setReviewId('')} onExpense={(id,expenseId)=>{if(externalPending.current)return;setGroupContext({id,expenseId});setPersonFilter('');setPeopleFilter('all');setPeopleCurrency('');setSection('people');void load('',false,id,true);}}/>:<fieldset disabled={busy||!!draft||navBusy} className="shared-content">
  {inbox?.verificationRequired?<p>Verify your email in account settings to send and receive requests.</p>:accepting?<form className="shared-form" onSubmit={event=>{event.preventDefault();send('/expense-shares/'+accepting.share.id+'/respond',{action:'accept',budgetId:snapshot.id,expectedRevision:snapshot.revision,categoryId});}}>
   <h3>Accept your share · {accepting.expense.merchant}</h3>
   <strong>{money(accepting.share.amount,accepting.expense.currency)}</strong>
   {accepting.expense.groupId&&accepting.expense.groupBudgetId!==snapshot.id?<p>Join this group and open the budget you chose for it before accepting this share.</p>:b.currency!==accepting.expense.currency?<div className="shared-budget-route"><p>Choose a budget in {accepting.expense.currency} to accept this share. Your current budget uses {b.currency}.</p><button type="button" className="button secondary" onClick={chooseBudget}>Choose budget</button></div>:<>
   <Field label="Category for your share"><Select required value={categoryId} onChange={e=>setCategoryId(e.target.value)}><option value="">Choose a category</option>{b.categories.map(c=><option key={c.id} value={c.id}>{c.group} · {c.name}</option>)}</Select></Field>
   <p>Your share will count as spending on {accepting.expense.date}. Available cash will be set aside for repayment. Paying later will not count as spending again.</p>
   {acceptPreview&&<div className="shared-budget-preview" aria-live="polite"><div><span>Cash set aside for repayment</span><strong>{fmt(acceptPreview.reserved)}</strong></div><div><span>Left in this category</span><strong>{fmt(acceptPreview.categoryLeft)}</strong></div><div><span>Available to plan</span><strong>{fmt(acceptPreview.ready)}</strong></div>{acceptPreview.unfunded>0&&<p>{fmt(acceptPreview.unfunded)} still needs funding. Move money into this category after accepting.</p>}</div>}
   {accepting.share.confirmed>0&&<p>The payer already recorded {fmt(accepting.share.confirmed)} received. After accepting, add that payment to your budget only if you paid and have not recorded it.</p>}
   <button className="button primary" disabled={!acceptPreview} type="submit">Accept share and update budget</button></>}
   <button className="button ghost" type="button" onClick={()=>setAccepting(null)}>Back to People</button>
  </form>:creating?<form onSubmit={e=>{e.preventDefault();create();}} className="shared-form">
   <Field label="Purchase you paid for"><Select required value={entryId} onChange={e=>setEntryId(e.target.value)}><option value="">Choose a purchase</option>{b.entries.filter(e=>e.kind==='expense'&&!e.splits&&!e.sharedSettlementId&&!e.sharedExpenseId&&e.date<=today()).slice().reverse().map(e=><option key={e.id} value={e.id}>{e.date} · {e.payee} · {fmt(e.amount)}</option>)}</Select></Field>
   <Field label="How to split"><Select value={splitMethod} onChange={e=>chooseSplitMethod(e.target.value as SplitMethod)}><option value="equal">Equally</option><option value="amount">By amount</option><option value="percent">By percentage</option><option value="shares">By shares</option></Select></Field>
   {(splitMethod==='percent'||splitMethod==='shares')&&<Field label={splitMethod==='percent'?'Your percentage':'Your share units'}><input required inputMode="decimal" value={ownWeight} onChange={e=>setOwnWeight(e.target.value)}/></Field>}
   {people.map((person,index)=><div className="shared-person" key={index}><Field label={'Person '+(index+1)+' name'}><input maxLength={100} required={!person.email} value={person.name} onChange={e=>setPeople(values=>values.map((p,i)=>i===index?{...p,name:e.target.value}:p))}/></Field><Field label="Email (optional)"><input type="email" maxLength={254} autoComplete="off" value={person.email} onChange={e=>setPeople(values=>values.map((p,i)=>i===index?{...p,email:e.target.value}:p))}/></Field>{!equal&&<Field label={splitMethod==='percent'?'Their percentage':splitMethod==='shares'?'Their share units':'Their share'}><input required inputMode="decimal" value={person.amount} onChange={e=>setPeople(values=>values.map((p,i)=>i===index?{...p,amount:e.target.value}:p))}/></Field>}{people.length>1&&<button type="button" className="text-button" onClick={()=>setPeople(values=>values.filter((_,i)=>i!==index))}>Remove person</button>}</div>)}
   {people.length<20&&<button type="button" className="button secondary" onClick={()=>setPeople(values=>[...values,{name:'',email:'',amount:'',personKey:crypto.randomUUID()}])}>Add person</button>}
   {equal&&entry&&<p>Each person owes {fmt(Math.floor(entry.amount/(people.length+1)))}. Your share is {fmt(entry.amount-Math.floor(entry.amount/(people.length+1))*people.length)}, including any rounding remainder.</p>}
   {splitMethod==='percent'&&<p className="muted small">Percentages must add up to 100%.</p>}{splitMethod==='shares'&&<p className="muted small">2 share units cost twice as much as 1.</p>}
   <p className="muted small">Each person reviews their share before it enters their budget. After saving, you can send an invitation by message.</p>
   {splitPreview&&entry&&<div className="shared-budget-preview" aria-live="polite"><div><span>Your spending</span><strong>{fmt(splitPreview.personalSpending)}</strong></div><div><span>Friends owe you</span><strong>{fmt(entry.amount-splitPreview.personalSpending)}</strong></div><div><span>Left in this category</span><strong>{fmt(splitPreview.categoryLeft)}</strong></div><div><span>Available to plan</span><strong>{fmt(splitPreview.ready)}</strong></div>{b.accounts.find(a=>a.id===entry.accountId)?.type==='credit'&&<p>You remain responsible for the full card purchase. Repayments first cover card debt still needing cash.</p>}</div>}
   <div className="button-row"><button type="submit" className="button primary">Save split</button><button type="button" className="button ghost" onClick={()=>{setCreating(false);setEntryId('');setPeople([{name:'',email:'',amount:'',personKey:crypto.randomUUID()}]);setSplitMethod('equal');setOwnWeight('1');setError('');}}>Cancel</button></div>
  </form>:payment?<form className="shared-form repayment-form" onSubmit={e=>{e.preventDefault();recordPayment(e.currentTarget);}}>
   <div className="repayment-summary"><div><h3>{payment.expense.merchant||'Shared purchase'}</h3><p className="repayment-recipient">{receiving?'From':'To'} <strong>{receiving?(payment.share.name||payment.share.email||'this person'):payment.expense.payer}</strong> · {payment.expense.currency}</p></div>
    {payment.settlement&&<strong className="repayment-amount">{money(payment.settlement.amount,payment.expense.currency)}</strong>}
   </div>
   {paymentNeedsBudget?<div className="shared-budget-route" aria-live="polite"><p>{paymentBudgetId&&budgetNames[paymentBudgetId]?<>Open <strong>“{budgetNames[paymentBudgetId]}”</strong> to record this repayment.</>:'This repayment belongs to another budget.'}<span className="shared-current-budget">You are currently in “{b.name}”.</span></p></div>:<>
    {!payment.settlement&&<Field label={receiving?"Amount received":"Repayment amount"}><input name="amount" inputMode="decimal" required defaultValue={(Math.max(0,payment.share.amount-payment.share.confirmed-payment.share.pending-(payment.share.offset??0)))/100}/></Field>}
    <Field label={receiving?'Received into':'Paid from'}><Select required name="account"><option value="">Choose an account</option>{b.accounts.filter(a=>['checking','savings'].includes(a.type)).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
    {!receiving&&(payment.expense.ledgerVersion??1)<2&&<Field label="Category for your share"><Select name="category" required><option value="">Choose a category</option>{b.categories.map(c=><option key={c.id} value={c.id}>{c.group} · {c.name}</option>)}</Select></Field>}
    <Field label={receiving?'Date received':'Date paid'}><DatePicker name="date" required defaultValue={payment.settlement?.date??today()} min={payment.importReceived?payment.expense.date:payment.settlement?.date??payment.expense.date} max={payment.importReceived?payment.settlement?.date:today()}/></Field>
    <label className="shared-check"><input type="checkbox" name="confirmed" required/>{receiving?'I received this money and have not already recorded it':'I have paid this person and have not already recorded this repayment'}</label>
    <p className="muted small">{payment.expense.kind==='refund'?(receiving?'Returns the refunded money to your account and original category. This does not record income or spending again.':'Records the refund paid back to this person. Your personal spending stays unchanged.'):(payment.expense.ledgerVersion??1)>=2?(receiving?'Adds money to your receiving account and reduces what this person owes. Spending stays unchanged. Any card debt still needing cash is covered first.':'Records money leaving your account and reduces what you owe. Your category was charged when you accepted; spending stays unchanged.') :payment.importReceived?'Adds this payment to your budget only. The payer has already recorded receipt and will not be credited again.':receiving?'Adds a reimbursement to your receiving account and the original purchase category. Card debt stays unchanged.':'Adds your share as a purchase and asks the original payer to confirm receipt.'}</p>
    {payment.receiveOffline&&<p className="small muted">Recorded by you. Their acceptance is not required.</p>}
    {receiving&&(payment.expense.ledgerVersion??1)<2&&<p className="small">Returns to {b.categories.find(c=>c.id===b.entries.find(e=>e.id===payment.expense.entryId)?.categoryId)?.name??'the original purchase category'}.</p>}
   </>}
   <p className="people-footnote">SpentOn records repayments. It does not send money.</p>
   <div className="people-editor-actions"><button type="button" className="button secondary" onClick={()=>{setPayment(null);setAccepting(null);setError('');}}>Back to People</button>
    {paymentNeedsBudget?<button type="button" className="button primary" onClick={chooseBudget}>Choose budget<ArrowRight size={16} aria-hidden="true"/></button>:<button className="button primary" type="submit">{payment.importReceived?'Add payment to my budget':payment.receiveOffline?'Record money received':receiving?'Confirm money received':'Record repayment'}</button>}
   </div>
  </form>:<>
   {groupContext&&<div className="group-context"><strong>Group expenses</strong><button type="button" className="text-button" onClick={()=>{setSelectedGroup(groupContext.id);setGroupContext(null);setSection('groups');}}>Back to group</button></div>}
   {inbox&&<PeopleOverview balances={inbox.balances??[]} filter={peopleFilter} onFilter={changePeopleScope} currencyFilter={peopleCurrency} onCurrency={value=>changePeopleScope(peopleFilter,value)} scope={groupContext?'This group':'Across your budgets'} hasBills={inbox.expenses.length>0||!!inbox.hasMore} search={personSearch} onSearch={setPersonSearch} selected={personFilter} view={peopleView} onView={setPeopleView} forceHistory={!!groupContext} review={personFilter===loadedPerson&&(groupContext?.id??'')===loadedGroup?<PeopleReviewQueue rows={visibleExpenses} balances={inbox.balances??[]} hasMore={!!inbox.hasMore} expanded={reviewsExpanded} onExpand={()=>setReviewsExpanded(!reviewsExpanded)} onAction={actOnShare}/>:null} onSelect={key=>{if(groupContext)setGroupContext({...groupContext,expenseId:''});setPersonFilter(key);setExpandedBill('');void load(key);}} onClear={()=>{if(groupContext)setGroupContext({...groupContext,expenseId:''});setPersonFilter('');setExpandedBill('');void load('');}}>
   <div className="people-bills-heading"><div><h3>{personFilter?'Bills with '+((inbox.balances??[]).filter(person=>personKey(person)===personFilter).map(personName)[0]??'this person'):'Shared bills'}</h3><p>{scoped?`${peopleCurrency||'All currencies'} · ${peopleFilter==='incoming'?'Owed to you':peopleFilter==='outgoing'?'Your shares and requests':peopleFilter==='settled'?'Settled or closed shares':'All shares'}`:'Open a bill for invitations, receipts and payment history.'}</p></div>{scoped&&<button type="button" className="text-button" onClick={clearPeopleScope}>Clear bill filters</button>}</div>
   {(personFilter!==loadedPerson||(groupContext?.id??'')!==loadedGroup)?(loadError?<p className="muted">History could not be loaded. Try again above.</p>:<LoadingState layout="list" label="Loading shared history"/>):!visibleExpenses.length?<div className="people-bills-empty"><h3>{scoped?'No bills match these filters':personFilter?'No shared bills to show':'Your shared expenses start here'}</h3><p>{scoped?'Clear the filters or load earlier expenses to see more history.':'Split a recorded purchase to track each person’s share here.'}</p>{scoped&&<button type="button" className="button secondary" onClick={clearPeopleScope}>Show all bills</button>}</div>:visibleExpenses.map(({expense,shares})=>{
    const payer=(inbox.balances??[]).find(person=>person.email===expense.payer),payerName=payer?personName(payer):expense.payer;
    return <SharedExpenseCard key={expense.id} expense={expense} shares={shares} payerName={payerName} budgetId={snapshot.id} groupVersion={inbox.groupVersion} expanded={expandedBill===expense.id} onToggle={()=>setExpandedBill(expandedBill===expense.id?'':expense.id)} onAction={(share,action,controlId)=>actOnShare(expense,share,action,controlId)}
     onRespond={(share,action)=>{void respond(share,action,expense);}}
     onInvite={share=>{rememberAction(expense.id);if(expense.groupId){setSelectedGroup(expense.groupId);setGroupContext(null);setSection('groups');}else send('/expense-shares/'+share.id+'/invite',{});}}
     onPayment={value=>{rememberAction(expense.id);setNotice('');setPayment(value);}} onDispute={settlement=>send('/share-settlements/'+settlement.id,{action:'dispute'})}
     onReceipt={()=>void openBill(expense.id)}
     onReviewChange={id=>{setReviewId(id);setSelectedGroup(expense.groupId??'');setSection('groups');}}
     onGroup={()=>{if(expense.groupId&&!pending.current&&!externalPending.current){setSelectedGroup(expense.groupId);setGroupContext(null);setSection('groups');}}}
     onChange={(kind,settlement)=>{setNotice('');if(kind==='reverse_payment'){if(settlement)setChangeDraft({kind,expense,settlement});}else setChangeDraft({kind,expense});}}/>;
   })}
   {inbox.hasMore&&personFilter===loadedPerson&&<div className="people-load-history"><p>More history is available. Filters apply to the bills loaded so far.</p><button className="button secondary" disabled={historyLoading} onClick={()=>void load(personFilter,true)}>{historyLoading?<LoadingState layout="inline" label="Loading earlier bills"/>:'Load earlier bills'}</button></div>}
   {(sharedTotals.receivable>0||sharedTotals.owed>0)&&<details className="people-budget-context"><summary>In your current budget: {b.name}</summary><section className="shared-budget-preview" aria-label="Shared amounts in this budget"><h3>{b.name} · {b.currency} · Current month</h3><div><span>Friends owe you</span><strong>{fmt(sharedTotals.receivable)}</strong></div><div><span>You owe</span><strong>{fmt(sharedTotals.owed)}</strong></div><div><span>Cash set aside for friends</span><strong>{fmt(sharedTotals.reserved)}</strong></div><p>Money owed to you is not available to spend. Payments recorded in this budget reduce what you owe immediately. People keeps them outstanding until the recipient confirms the money arrived.</p></section></details>}
  </PeopleOverview>}
  {!inbox&&!loadError&&<LoadingState layout="list" label="Loading People" detail="Getting your shared bills and repayment history."/>}
  </>}
  </fieldset>}
  {changeDraft&&<Modal title={changeDraft.kind==='correct'?'Correct shared bill':changeDraft.kind==='refund'?'Record shared refund':'Reverse repayment'} wide className="group-dialog" onClose={()=>{if(groupRequest.canClose()){removeSharingDraft(draftScope,changeDraftKey(changeDraft));setChangeDraft(null);}}}><div className="form-body">{groupRequest.recovery}<SharedChangeComposer draft={changeDraft} snapshot={snapshot} request={groupRequest} onCreated={(change:SharedChange)=>{setChangeDraft(null);setReviewId(change.id);setSelectedGroup(change.groupId??'');setSection('groups');}} onCancel={()=>setChangeDraft(null)}/></div></Modal>}
  {!payment&&<p className="people-footnote">SpentOn records repayments. It does not send money.</p>}
 </div>;
 return creating||payment||accepting?<Modal title={creating?"Split a purchase":accepting?"Accept share":paymentNeedsBudget?"Open the repayment budget":payment?.importReceived?"Add repayment to budget":receiving?(payment?.settlement?"Confirm money received":"Record money received"):"Record repayment"} onClose={close} wide className={'people-dialog'+(paymentNeedsBudget?' budget-switch-dialog':'')}>{content}</Modal>:<section className="people-workspace" aria-label="People">{content}</section>;
}
