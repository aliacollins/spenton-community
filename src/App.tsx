import SharedExpenses from './SharedExpenses';
import {sharingScope,pendingSharingRequest} from './sharing-drafts';
import Transactions from './TransactionsPage';
import AmountInput from './AmountInput';
import {LearningWelcome,OnboardingCoach} from './OnboardingJourney';
import {onboardingErrorReason} from './onboarding-client';
import type {OnboardingController,LearningStep} from './onboarding-client';
import type {LearningAction} from './OnboardingJourney';
import Insights from './InsightsPage';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, CircleAlert, Clock3, Download, LayoutGrid, ListFilter, Menu, Pencil, Plus, Search, ShieldCheck, Sparkles, Target, TrendingUp, Undo2, Wallet, X, CheckCircle2, Landmark, Users, Palette } from 'lucide-react';
import { allocate, calculate, cents, id, money, monthEnd, targetNeed, thisMonth, today, validateBudget } from './engine';
import { targetProgress, targetSummary } from './targets';
import type { Account, Budget, Category, Totals } from './engine';
import { exportBudget } from './storage';
import { api, CloudError, getBudget, putBudget } from './cloud';
import type { BudgetMutation, CloudBudget, CloudUser } from './cloud';
import SpaceMenu from './SpaceMenu';
import type { BillingStatus } from './AccessPanel';
import BudgetHistory from './BudgetHistory';
import CardActivity from './CardActivity';
import InvestmentDetail from './InvestmentDetail';
import PipCompanion from './PipCompanion';
import { CategoryIcon, Empty, Progress, Modal } from './ui';
import Dialogs from './Dialogs';
import MonthPicker from './MonthPicker';
import type { DialogState } from './Dialogs';
import AppAppearanceDialog from './AppAppearance';
import {useAppAppearance} from './app-appearance';
import {usePipViewMotion} from './pip-view-motion';
import MobileScreenGuidance from './MobileScreenGuidance';
import BudgetSharingNote from './BudgetSharingNote';
import {budgetResetRestriction} from './budget-reset';
import SubscriptionsPage from './SubscriptionsPage';
import {Repeat2} from 'lucide-react';

type Page='budget'|'transactions'|'accounts'|'insights'|'subscriptions';
type Filter='all'|'attention'|'funded';
const pageLabels:Record<Page,string>={budget:'Budget',transactions:'Transactions',accounts:'Accounts',insights:'Insights',subscriptions:'Subscriptions'};
const shortDate=(date:string)=>new Date(date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
type AppProps={onboarding:OnboardingController;initialSnapshot:CloudBudget;user:CloudUser;billing:BillingStatus|null;onManagePlan:()=>void;onWorkspace:()=>void;onAccount:()=>void;onReauthenticate:()=>void;onSignOut:()=>Promise<boolean>};
type PendingSave={mutation:BudgetMutation;message:string};

export default function App({onboarding,initialSnapshot,user,billing,onManagePlan,onWorkspace,onAccount,onReauthenticate,onSignOut}:AppProps){
 const {appearance,update:updateAppearance,remembered}=useAppAppearance(user.id);
 const pipView=appearance.view==='pip';
 const supportsSubscriptions=!!initialSnapshot.ownerTest||initialSnapshot.subscriptionVersion===1;
 const appRoot=useRef<HTMLDivElement>(null);
 const [appearanceOpen,setAppearanceOpen]=useState(false),[savedFeedback,setSavedFeedback]=useState(0);
 const [ledgerColumns,setLedgerColumns]=useState(()=>innerWidth<=520?3:innerWidth<=760?4:5);
 useEffect(()=>{const resize=()=>setLedgerColumns(innerWidth<=520?3:innerWidth<=760?4:5);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);},[]);
 const [b,setBudget]=useState<Budget>(initialSnapshot.budget);
 const [plannedShareCount,setPlannedShareCount]=useState(initialSnapshot.plannedShares?.length??0);
 const [sharedOpen,setSharedOpen]=useState(()=>!initialSnapshot.ownerTest&&(new URLSearchParams(location.search).has("people")||new URLSearchParams(location.search).has("groups")||!!pendingSharingRequest(sharingScope(user.id,initialSnapshot.id),'groups')||!!pendingSharingRequest(sharingScope(user.id,initialSnapshot.id),'changes')||!!pendingSharingRequest(sharingScope(user.id,initialSnapshot.id),'people')));
 const [page,setPage]=useState<Page>('budget');const [month,setMonth]=useState(thisMonth());
 const [learningWelcome,setLearningWelcome]=useState(false),[learningAction,setLearningAction]=useState<LearningStep|null>(null);
 const [dialog,setDialogState]=useState<DialogState|null>(null);const [selected,setSelected]=useState<string|null>(()=>window.matchMedia(pipView?'(max-width:1400px)':'(max-width:1000px)').matches?null:initialSnapshot.budget.categories[0]?.id??null);
 const previouslySelected=useRef(selected);
 useEffect(()=>{
  const changed=previouslySelected.current!==selected;previouslySelected.current=selected;
  if(!changed||!pipView||!selected||innerWidth>1400)return;
  const frame=requestAnimationFrame(()=>{
   if(appRoot.current?.querySelector('dialog[open]'))return;
   const panel=appRoot.current?.querySelector<HTMLElement>('.category-detail');
   panel?.scrollIntoView({block:'start',behavior:appearance.motion&&!matchMedia('(prefers-reduced-motion:reduce)').matches?'smooth':'auto'});
   panel?.querySelector<HTMLElement>('h2')?.focus({preventScroll:true});
  });
  return()=>cancelAnimationFrame(frame);
 },[selected,pipView,appearance.motion]);
 const [filter,setFilter]=useState<Filter>('all');const [query,setQuery]=useState('');const [accountFilter,setAccountFilter]=useState('all');
 const [collapsed,setCollapsed]=useState<Set<string>>(new Set());const [mobileNav,setMobileNav]=useState(false);const [dense,setDense]=useState(true);
 const [adding,setAdding]=useState<string|null>(null);
 const [history,setHistory]=useState<Budget[]>([]);const [toast,setToast]=useState('');
 const [toastTone,setToastTone]=useState<'info'|'success'|'error'>('info');
 const [transactionEditing,setTransactionEditing]=useState(false);
 function notify(message:string,tone:'info'|'success'|'error'='info'){setToastTone(tone);setToast(message);}
 const revision=useRef(initialSnapshot.revision);
 const editingTransaction=useRef(false);
 const sharedNavigation=useRef<(()=>boolean)|null>(null);
 const setDialog:typeof setDialogState=next=>{if(sharedNavigation.current&&!sharedNavigation.current())return;setDialogState(next);};
 const editingSchedule=useRef(false);editingSchedule.current=dialog?.type==='transaction'&&!!dialog.schedule;
 const pending=useRef<PendingSave|null>(null),savingRef=useRef(false);
 const [saving,setSaving]=useState(false),[saveError,setSaveError]=useState<CloudError|null>(null);
 usePipViewMotion(appRoot,pipView,appearance.motion,sharedOpen?'people':page);
 const alive=useRef(true);
 const totals=useMemo(()=>calculate(b,month),[b,month]);const t=totals;const fmt=(n:number)=>money(n,b.currency);
 async function transmit(operation:PendingSave){
  if(savingRef.current)return;
  savingRef.current=true;setSaving(true);setSaveError(null);
  try{
   const result=await putBudget(initialSnapshot.id,operation.mutation,initialSnapshot.ownerTest);
   if(result.id!==initialSnapshot.id)throw new CloudError(502,'INVALID_SNAPSHOT','The service returned a different budget. Your draft has been kept.');
   revision.current=result.revision;pending.current=null;void onboarding.refresh();
   if(alive.current){setBudget(result.budget);setPlannedShareCount(result.plannedShares?.length??0);notify(operation.message,'success');setSavedFeedback(value=>value+1);}
  }catch(error){if(learningAction)onboarding.event(learningAction,'blocked',onboardingErrorReason(error));if(alive.current)setSaveError(error instanceof CloudError?error:new CloudError(0,'SAVE_FAILED',error instanceof Error?error.message:'Could not save this change.'));}
  finally{savingRef.current=false;if(alive.current)setSaving(false);}
 }
 function commit(next:Budget,message:string,_allowRecovery?:boolean,serviceAction:'budget.saved'|'import.completed'='budget.saved'){
  if(!initialSnapshot.ownerTest&&(!billing?.canEdit||billing.state!=='self-hosted'&&(!billing.accessEndsAt||new Date(billing.accessEndsAt).getTime()<=Date.now())))throw new Error('Your budget is in view-only mode. Open Your plan to continue editing. You can still view and export your budget.');
  if(pending.current)throw new Error('Finish saving or resolve the unsaved change before making another change.');
  const budget=validateBudget(next);
  if(budget.demo)throw new Error('The fictional sample cannot replace a saved budget.');
  const operation:PendingSave={mutation:{budget,expectedRevision:revision.current,mutationId:id(),reviewed:true,serviceAction},message};
  pending.current=operation;setHistory(h=>[...h.slice(-19),b]);setBudget(budget);void transmit(operation);
 }
 async function refreshFromServer(discard=false){
  // Inline transaction and schedule editors retain their drafts and reject changed source entries.
  const hasOpenEdit=()=>!!sharedNavigation.current||!editingSchedule.current&&(!!document.querySelector('dialog[open]')||!editingTransaction.current&&!!document.activeElement?.matches('input,textarea,select,[contenteditable="true"]'));
  if(savingRef.current||!discard&&(pending.current||hasOpenEdit()))return;
  try{
   const latest=await getBudget(initialSnapshot.id,initialSnapshot.ownerTest);
   if(!alive.current||savingRef.current||!discard&&(pending.current||hasOpenEdit()))return;
   if(discard||latest.revision>revision.current){revision.current=latest.revision;pending.current=null;setBudget(latest.budget);setPlannedShareCount(latest.plannedShares?.length??0);setHistory([]);setSaveError(null);setDialog(current=>!discard&&current?.type==='transaction'&&current.schedule?current:null);notify(discard?'Loaded the saved account version':'Updated from your account');}
  }catch(error){if(alive.current)notify(error instanceof Error?error.message:'Could not refresh your budget.','error');}
 }
 async function signOut(){if(sharedNavigation.current&&!sharedNavigation.current())return;if(editingTransaction.current||pending.current){notify('Save or cancel your unsaved changes before signing out.');return;}if(!await onSignOut())notify('Could not sign out. Please try again.','error');}
 async function exportSaved(){if(pending.current){exportBudget(b);return;}try{const result=await api<CloudBudget>((initialSnapshot.ownerTest?'/owner-tests/':'/budgets/')+initialSnapshot.id+'/export',{method:'POST',body:{operationId:id()}});exportBudget(result.budget);}catch(error){notify(error instanceof Error?error.message:'Could not prepare your export.','error');}}
 function openPlan(){if(sharedNavigation.current&&!sharedNavigation.current())return;if(editingTransaction.current){notify('Save or cancel the transaction edit before opening Your plan.');return;}onManagePlan();}
 function openWorkspace(){if(sharedNavigation.current&&!sharedNavigation.current())return;if(editingTransaction.current){notify('Save or cancel the transaction edit before leaving.');return;}if(pending.current){notify('Resolve the unsaved change before leaving this budget.');return;}onWorkspace();}
 function action(fn:()=>void){try{fn();}catch(e){notify(e instanceof Error?e.message:'Please try again.','error');}}
 function undo(){if(!history.length)return;const previous=history[history.length-1];action(()=>{const before=[...history];commit(previous,'Change undone');setHistory(before.slice(0,-1));});}
 function navigate(next:Page,account='all'){if(sharedNavigation.current&&!sharedNavigation.current())return;setSharedOpen(false);if(editingTransaction.current){if(next===page&&account===accountFilter)return;notify('Save or cancel the transaction edit before changing pages or accounts.');return;}setPage(next);setQuery('');setAccountFilter(account);setMobileNav(false);setAdding(null);setSelected(next==='budget'&&!window.matchMedia(pipView?'(max-width:1400px)':'(max-width:1000px)').matches?(b.categories[0]?.id??null):null);}
 function openPeople(){if(sharedNavigation.current&&!sharedNavigation.current())return;if(pending.current||editingTransaction.current){notify('Save or cancel your transaction draft first.');return;}setSharedOpen(true);setMobileNav(false);}
 function addCategory(name:string,group:string){
  if(b.categories.some(c=>c.name.toLowerCase()===name.toLowerCase()))throw new Error('A category with this name already exists.');
  const category:Category={id:id(),name,group,icon:'wallet',color:'sage',target:0,targetType:'monthly'};
  commit({...b,categories:[...b.categories,category]},'Subcategory added');
  setAdding(null);setQuery('');setFilter('all');setSelected(category.id);
 }
 function openLearning(){
  if(editingTransaction.current||pending.current){notify('Save or cancel your current change before opening the guide.');return;}
  setMobileNav(false);if(!onboarding.state){void onboarding.refresh();return;}
  if(onboarding.state.status==='completed'){setDialog({type:'pipGuide'});return;}
  if(onboarding.state.status==='offered'){setLearningWelcome(true);return;}
  if(onboarding.state.status!=='active')void onboarding.command({operation:'resume'}).then(ok=>{if(ok)requestAnimationFrame(()=>document.getElementById('learning-coach')?.scrollIntoView({block:'start',behavior:'smooth'}));});
  else document.getElementById('learning-coach')?.scrollIntoView({block:'start',behavior:'smooth'});
 }
 function learningDo(action:LearningAction){
  if(editingTransaction.current||pending.current){notify('Save or cancel your current change before continuing setup.');return;}
  const step=action==='purchase'?'purchase':action==='plan'||action==='income'?'plan':action==='insights'?'insights':'budget';setLearningAction(step);setMonth(thisMonth());
  if(action==='insights'){navigate('insights');return;}
  if(action==='account'){navigate('accounts');return;}
  if(action==='goal'){const category=b.categories.find(c=>c.icon==='umbrella')??b.categories[0];if(category)setDialog({type:'goal',category});return;}
  setDialog(action==='plan'?{type:'plan'}:{type:'transaction',kind:action==='income'?'income':'expense'});
 }
 useEffect(()=>{
  if(!learningAction||!dialog||onboarding.state?.status!=='active')return;
  const current=document.querySelector('dialog[open]');if(!current)return;
  const invalid=()=>onboarding.event(learningAction,'blocked','input');
  const submitted=()=>requestAnimationFrame(()=>{if(current.querySelector('.form-error'))invalid();});
  current.addEventListener('invalid',invalid,true);current.addEventListener('submit',submitted);
  return()=>{current.removeEventListener('invalid',invalid,true);current.removeEventListener('submit',submitted);};
 },[dialog,learningAction,onboarding.state?.analyticsConsent]);
 function advanceMonth(n:number){const [y,m]=month.split('-').map(Number);const next=new Date(y,m-1+n,1);setMonth(next.getFullYear()+'-'+String(next.getMonth()+1).padStart(2,'0'));}
 useEffect(()=>{if(!toast||toastTone==='error')return;const timer=setTimeout(()=>setToast(''),6500);return()=>clearTimeout(timer);},[toast,toastTone]);
 useEffect(()=>{
  alive.current=true;
  const beforeUnload=(event:BeforeUnloadEvent)=>{if(pending.current||editingTransaction.current){event.preventDefault();event.returnValue='';}};
  const focus=()=>{if(document.visibilityState==='visible')void refreshFromServer();};
  const timer=setInterval(focus,30000);
  window.addEventListener('beforeunload',beforeUnload);window.addEventListener('focus',focus);
  return()=>{alive.current=false;clearInterval(timer);window.removeEventListener('beforeunload',beforeUnload);window.removeEventListener('focus',focus);};
 },[initialSnapshot.id]);
 useEffect(()=>{
  if(initialSnapshot.ownerTest)return;
  let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
  const controller=new AbortController();
  const poll=async()=>{
   let delay=1000;
   try{
    if(document.visibilityState==='visible'){
     const change=await api<{revision:number;changed:boolean}>('/budgets/'+encodeURIComponent(initialSnapshot.id)+'/changes?after='+revision.current,{signal:controller.signal});
     if(!stopped&&change.changed)await refreshFromServer();
    }
   }catch{delay=15000;}
   if(!stopped)timer=setTimeout(poll,delay);
  };
  void poll();
  return()=>{stopped=true;controller.abort();clearTimeout(timer);};
 },[initialSnapshot.id]);
 useEffect(()=>{const listener=(e:KeyboardEvent)=>{if((e.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')||dialog||appearanceOpen||sharedOpen||e.ctrlKey||e.metaKey||e.altKey)return;if(e.key==='n'){setDialog({type:'transaction'});e.preventDefault();}if(e.key==='m'){setDialog({type:'allocation'});e.preventDefault();}if(e.key==='/'){document.getElementById('workspace-search')?.focus();e.preventDefault();}};window.addEventListener('keydown',listener);return()=>window.removeEventListener('keydown',listener);},[dialog,appearanceOpen,sharedOpen]);
 const groups=[...new Set([...(b.groups??[]),...b.categories.map(c=>c.group)])];
 const attention=b.categories.filter(c=>t.categories[c.id].available<0||targetNeed(c,t.categories[c.id],month)>0);
 const visibleCategories=b.categories.filter(c=>(c.name+' '+c.group+' '+(b.categories.find(p=>p.id===c.parentId)?.name??'')).toLowerCase().includes(query.toLowerCase())&&(filter==='all'||(filter==='attention'?attention.includes(c):!attention.includes(c))));
 const cardAccounts=b.accounts.filter(a=>a.type==='credit');
 const selectedCategory=b.categories.find(c=>c.id===selected);
 const assigned=b.entries.filter(e=>e.kind==='allocation'&&e.date.slice(0,7)===month).reduce((sum,e)=>sum+(e.from==='ready'?e.amount:e.to==='ready'?-e.amount:0),0);
 const reserve=Object.values(t.cards).reduce((sum,c)=>sum+c.reserve,0);
 const currentTotals=month===thisMonth()?t:calculate(b,thisMonth());
 const pipConcern=Math.max(0,-currentTotals.ready)+b.categories.reduce((sum,c)=>sum+Math.max(0,-currentTotals.categories[c.id].available),0)+Object.values(currentTotals.cards).reduce((sum,c)=>sum+c.unbacked,0);
 const totalLeft=b.categories.reduce((sum,c)=>sum+Math.max(0,t.categories[c.id].available),0);
 const wideLedger=pipView&&[assigned,totalLeft,t.spent,...b.categories.flatMap(c=>[t.categories[c.id].assigned,t.categories[c.id].spent,t.categories[c.id].available])].some(value=>fmt(value).length>11);
 const navItems=([{page:'budget',icon:LayoutGrid},...(pipView&&!initialSnapshot.ownerTest?[{page:'people' as const,icon:Users}]:[]),{page:'transactions',icon:ArrowLeftRight},{page:'subscriptions',icon:Repeat2},{page:'accounts',icon:Wallet},{page:'insights',icon:TrendingUp}] as const);
 return <div ref={appRoot} data-app-view={appearance.view} data-pip-motion={appearance.motion?'on':'off'} className={'app '+(page==='budget'?'budget-page ':'')+(dense?'compact ':'')+(mobileNav?'nav-open':'')}>
  {mobileNav&&<button className="nav-scrim" aria-label="Close navigation" onClick={()=>setMobileNav(false)}/>}
  <aside className="sidebar">
   <a href="#budget" className="brand" onClick={e=>{e.preventDefault();navigate('budget');}}><img className="spenton-symbol" src="/brand/spenton-symbol.svg" alt=""/><span>Spent<span className="brand-on">On</span></span></a>
   <SpaceMenu user={user} budget={b.name} billing={billing} onWorkspace={openWorkspace} onSettings={()=>setDialog({type:'settings'})} onAppearance={()=>setAppearanceOpen(true)} onAccount={()=>{if(sharedNavigation.current&&!sharedNavigation.current())return;if(editingTransaction.current||pending.current){notify('Save or cancel your changes before opening account settings.');return;}onAccount();}} onPlan={openPlan} onSignOut={()=>void signOut()}/>
   <span className="nav-heading">YOUR MONEY</span>
   <nav aria-label="Main navigation">{navItems.map(n=><button className={'nav-item '+(n.page==='people'?sharedOpen?'active':'':!sharedOpen&&page===n.page?'active':'')} aria-current={(n.page==='people'?sharedOpen:!sharedOpen&&page===n.page)?'page':undefined} key={n.page} onClick={()=>n.page==='people'?openPeople():navigate(n.page)}><n.icon size={19} strokeWidth={1.7}/><span>{n.page==='people'?'People':pageLabels[n.page]}</span>{n.page==='budget'&&<span className="nav-current-dot"/>}</button>)}</nav>
   <div className="sidebar-account-heading"><span className="nav-heading">ACCOUNTS</span><button className="icon-button" aria-label="Add account" onClick={()=>setDialog({type:'account'})}><Plus size={15}/></button></div>
   <div className="sidebar-accounts">{b.accounts.filter(a=>a.type!=='investment').map(a=><button className="sidebar-account" key={a.id} onClick={()=>navigate('transactions',a.id)}><span className={'account-dot '+a.type}/><span><strong>{a.name}</strong><small className={t.balances[a.id]<0?'negative':''}>{fmt(t.balances[a.id])}</small></span></button>)}{!b.accounts.length&&<button className="text-button" onClick={()=>setDialog({type:'account'})}>Add your first account <Plus size={14}/></button>}</div>
   {b.accounts.some(a=>a.type==='investment')&&<><div className="sidebar-account-heading"><span className="nav-heading">INVESTMENTS</span></div><div className="sidebar-accounts">{b.accounts.filter(a=>a.type==='investment').map(a=><button className="sidebar-account" key={a.id} onClick={()=>navigate('transactions',a.id)}><span className="account-dot investment"/><span><strong>{a.name}</strong><small className={t.balances[a.id]<0?'negative':''}>{fmt(t.balances[a.id])}</small></span></button>)}</div></>}
   <div className="sidebar-bottom">{!pipView&&!initialSnapshot.ownerTest&&<button className={'nav-item '+(sharedOpen?'active':'subtle')} onClick={openPeople}><Users size={19}/>People</button>}<button className="nav-item subtle" onClick={()=>setDialog({type:'pipGuide'})}><CircleHelp size={18}/>Help & guidance</button></div>
  </aside>
  <div className="main-shell">

   {initialSnapshot.ownerTest&&<div className="owner-test-banner"><strong>Owner test budget</strong><span>Budget changes stay in this test. Account and billing settings are live.</span><button className="text-button" onClick={openWorkspace}>Back to owner tests</button></div>}
   <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={()=>setMobileNav(true)}><Menu size={21}/></button><span>Personal space</span><ChevronRight size={13}/><strong>{sharedOpen?'People':pageLabels[page]}</strong></div><div className="topbar-right">{!sharedOpen&&<span className="save-indicator" role="status" data-state={saveError?'error':saving?'saving':transactionEditing?'editing':'saved'}>{saveError?<CircleAlert size={15}/>:saving?<Clock3 size={15}/>:transactionEditing?<Pencil size={15}/>:<CheckCheck size={15}/>} {saveError?'Not saved':saving?'Saving to your account...':transactionEditing?'Editing transaction':'Saved to your account'}</span>}<button type="button" className="appearance-switch" aria-label="App appearance" onPointerDown={event=>event.preventDefault()} onClick={()=>setAppearanceOpen(true)}><Palette size={16}/><span>{pipView?'Pip view':'Current view'}</span><ChevronDown className="appearance-chevron" size={13}/></button><span className="topbar-divider"/><button className="icon-button" aria-label="Help" onClick={()=>setDialog({type:'help'})}><CircleHelp size={19}/></button><button className="topbar-avatar" disabled={transactionEditing} aria-label="Budget settings" onClick={()=>setDialog({type:'settings'})}>A</button></div></header>
   {pipView&&<nav className="pip-mobile-tabs" aria-label="Budget pages">{navItems.filter(n=>n.page!=='subscriptions').map(n=><button type="button" key={n.page} aria-current={(n.page==='people'?sharedOpen:!sharedOpen&&page===n.page)?'page':undefined} onClick={()=>n.page==='people'?openPeople():navigate(n.page)}><n.icon size={19} aria-hidden="true"/><span>{n.page==='people'?'People':pageLabels[n.page]}</span></button>)}</nav>}
   <main className="main-content" tabIndex={-1}>
    {!initialSnapshot.ownerTest&&billing&&!billing.canEdit&&<div className="access-notice" role="status"><p><strong>Your budget is in view-only mode.</strong> {billing.disputeHold?' A payment dispute is being reviewed. You can view and export your saved budget or contact support@spenton.dev.':' Your saved plan is here to view and export. Choose a plan to continue editing.'}</p><button className="button secondary" onClick={openPlan}>Your plan</button></div>}
    {saveError&&<div className="warning-banner sync-banner" role="alert"><p><strong>Your latest change has not been confirmed.</strong> {saveError.message} Keep this page open until it is saved or exported.</p><div className="button-row">{saveError.status===402&&<button className="button primary" onClick={openPlan}>Choose a plan</button>}{saveError.status===401&&<button className="button primary" onClick={onReauthenticate}>Sign in again</button>}<button className="button secondary" disabled={saving||saveError.code==='REVISION_CONFLICT'||saveError.code==='MUTATION_REUSED'} onClick={()=>{if(pending.current)void transmit(pending.current);}}>Retry save</button><button className="button secondary" onClick={()=>exportBudget(b)}>Export unsaved draft</button><button className="button ghost" onClick={()=>setDialog({type:'confirm',destructive:true,title:'Load the saved version?',description:'This discards the unsaved change shown on this page and opens the latest version in your account. Export your unsaved draft first if you want to keep it.',label:'Discard draft and load saved',action:()=>{void refreshFromServer(true);}})}>Load saved version</button></div></div>}
   <MobileScreenGuidance/>
    {sharedOpen?<SharedExpenses userId={user.id} onWorkspace={openWorkspace} navigationGuard={sharedNavigation} initial={{...initialSnapshot,budget:b,revision:revision.current}} onSaved={next=>{revision.current=next.revision;setBudget(next.budget);setPlannedShareCount(next.plannedShares?.length??0);setHistory([]);}} onClose={()=>{setSharedOpen(false);void refreshFromServer(true);}}/>:<>
    <div className="app-page-header">
    <div className="page-heading"><div><div className="eyebrow">{page==='budget'?'SPEND WITH INTENTION':page==='transactions'?'TRANSACTION HISTORY':page==='accounts'?'THE WHOLE PICTURE':page==='subscriptions'?'RECURRING PAYMENTS':'A CLOSER LOOK AT YOUR MONEY'}</div><h1>{page==='budget'?'Your budget.':page==='transactions'?'Your transactions.':page==='accounts'?'Your accounts.':page==='subscriptions'?'Your subscriptions.':'Your insights.'}</h1><p>{page==='budget'?'Set money aside for spending and savings.':page==='transactions'?'Track income, spending and transfers.':page==='accounts'?'Balances from your entries. No bank connection.':page==='subscriptions'?'See what repeats, what it costs and when it is next due.':'Review your spending, balances and savings goals.'}</p></div><div className="heading-actions">{b.demo&&<span className="demo-pill"><Sparkles size={12}/> Sample budget</span>}<button className="button primary" disabled={transactionEditing||page==='subscriptions'&&(!supportsSubscriptions||saving||!!saveError||(!initialSnapshot.ownerTest&&!billing?.canEdit)||!b.categories.length||!b.accounts.some(a=>a.type!=='investment'))} onClick={()=>setDialog(page==='subscriptions'?{type:'subscription'}:page==='accounts'?{type:'account'}:{type:'transaction',kind:page==='transactions'&&b.accounts.find(a=>a.id===accountFilter)?.type==='investment'?'transfer':undefined,accountId:page==='transactions'&&accountFilter!=='all'?accountFilter:undefined})}><Plus size={17}/>{page==='accounts'?'Add account':page==='subscriptions'?'Add subscription':'Add transaction'}</button></div></div>
    <div className="month-toolbar">{page==='subscriptions'?<p className="subscription-scope">{b.name} · All scheduled dates · {b.currency}</p>:<fieldset className="month-switcher" aria-label="Budget month navigation" disabled={transactionEditing}><button className="icon-button" aria-label="Previous month" onClick={()=>advanceMonth(-1)}><ChevronLeft size={18}/></button><MonthPicker value={month} onChange={setMonth}/><button className="icon-button" aria-label="Next month" onClick={()=>advanceMonth(1)}><ChevronRight size={18}/></button>{month===thisMonth()?<span className="this-month">This month</span>:<button className="text-button" onClick={()=>setMonth(thisMonth())}>Back to this month</button>}</fieldset>}<div className="month-tools"><button className="text-button" disabled={!history.length||saving||!!saveError} onClick={undo}><Undo2 size={15}/>Undo</button><button className="text-button" aria-label="Export" onClick={()=>void exportSaved()}><Download size={15}/><span>Export</span></button></div></div>
    </div>
    <OnboardingCoach onComplete={()=>navigate('budget')} controller={onboarding} budget={b} totals={t} currentPage={page} budgetId={initialSnapshot.id} onAction={learningDo} onWorkspace={openWorkspace} saving={saving||!!saveError}/>
    {page==='budget'&&<>
     <div className="budget-overview">
     <div className="ready-stage">{onboarding.state?.status!=='active'&&<PipCompanion concern={pipConcern} motionEnabled={!pipView||appearance.motion} reactToConcern={!pipView||(!saving&&!saveError)} savedRevision={pipView?savedFeedback:undefined}/>}
     <section className={'ready-banner '+(t.ready<0?'overplanned':'')} aria-label="Available to plan"><div className="ready-main"><span className="ready-symbol"><Wallet size={23} strokeWidth={1.45}/></span><div><div className="ready-label">{t.ready<0?'CASH SHORTFALL':'AVAILABLE TO PLAN'}<span className="tiny-dot"/></div><div className="ready-amount">{fmt(t.ready)}<span>{t.ready===0?(attention.some(c=>t.categories[c.id].available<0)||Object.values(t.cards).some(c=>c.reserve<0)?'Cover the shortfalls in your plan.':'All your money is planned.'):t.ready<0?(t.cash<0?'You have spent more than you have.':'Your spending or category amounts need more cash.'):'Set money aside for spending or savings.'}</span></div></div></div><button className="button dark" onClick={()=>setDialog(t.ready<0||t.cashShortfall>0?{type:'cashShortfalls'}:t.ready>0?{type:'plan'}:{type:'allocation',to:'ready',from:b.categories[0]?.id})}>{t.ready<0||t.cashShortfall>0?'Cover the shortfall':t.ready>0?'Plan this money':'Adjust your plan'}<ArrowRight size={16}/></button><div className="banner-lines" aria-hidden="true"><i/><i/><i/></div></section></div>
     <div className="budget-summary"><span><i className="summary-dot"/>Cash in your accounts<strong>{fmt(t.cash)}</strong></span><span><i className="summary-dot allocated"/>{assigned<0?'Moved out this month':'Set aside this month'}<strong>{fmt(Math.abs(assigned))}</strong></span><span><i className="summary-dot spent"/>Spent this month<strong>{fmt(t.spent)}</strong></span><span><ShieldCheck size={14}/>Cash set aside for cards<strong>{fmt(reserve)}</strong></span></div>
     </div>
     {t.cashShortfall>0&&<div className="unreserved-notice cash-shortfall-notice"><Wallet size={16}/><span><strong>{fmt(t.cashShortfall)} was spent without category or payment-reserve cash.</strong> Already deducted from Available to plan.</span><button className="text-button" onClick={()=>setDialog({type:'cashShortfalls'})}>Review cash<ArrowRight size={14}/></button></div>}
     {cardAccounts.some(a=>t.cards[a.id].unbacked>0)&&<div className="unreserved-notice"><ShieldCheck size={16}/><span><strong>{fmt(cardAccounts.reduce((sum,a)=>sum+t.cards[a.id].unbacked,0))} of card debt still needs cash.</strong> Set cash aside before planning other spending.</span><button className="text-button" onClick={()=>{const a=cardAccounts.find(a=>t.cards[a.id].unbacked>0)!;setDialog({type:'allocation',from:'ready',to:'card:'+a.id,amount:Math.min(Math.max(0,t.ready),t.cards[a.id].unbacked)});}}>Set aside cash<ArrowRight size={14}/></button></div>}
     <div className={'budget-layout '+(selectedCategory?'with-detail':'')}>
      <section className="budget-panel">
       <div className="budget-controls"><div className="filter-tabs" role="group" aria-label="Category filter"><button className={filter==='all'?'active':''} onClick={()=>setFilter('all')}>All categories</button><button className={filter==='attention'?'active':''} onClick={()=>setFilter('attention')}>Needs attention <span>{attention.length}</span></button><button className={filter==='funded'?'active':''} onClick={()=>setFilter('funded')}>Funded</button></div><div className="budget-tools"><div className="table-search"><Search size={15}/><input id="workspace-search" aria-label="Search categories" placeholder="Find a category" value={query} onChange={e=>setQuery(e.target.value)}/><kbd>/</kbd></div><button className={(pipView?'button secondary budget-density-toggle':'icon-button')+' '+(dense?'selected-button':'')} aria-label={dense?'Use comfortable rows':'Use compact rows'} onPointerDown={event=>{if(pipView)event.preventDefault();}} onClick={()=>setDense(!dense)}><ListFilter size={18}/>{pipView&&<span>{dense?'Compact rows':'Comfortable rows'}</span>}</button><button className="button secondary move-button" data-tooltip={selected?'Move money from '+(b.categories.find(c=>c.id===selected)?.name??'the selected category')+'. Account balances stay the same.':'Move money between categories. Account balances stay the same.'} onClick={()=>setDialog({type:'allocation',from:selected??undefined})}><ArrowLeftRight size={15}/>Move category money</button></div></div>
       <div className={'ledger-scroll'+(wideLedger?' pip-wide-ledger':'')}><table className="budget-ledger" aria-label="Monthly budget"><colgroup><col className="category-col"/><col className="plan-col"/><col className="spent-col"/><col className="available-col"/><col className="detail-col"/></colgroup><thead><tr><th scope="col"><div className="ledger-category-heading">Category<button className="category-add-icon" aria-label="Add main category" data-tooltip="Add main category" onClick={()=>{setQuery('');setFilter('all');setDialog({type:'categoryGroup'});}}><Plus size={16}/></button></div></th><th scope="col">Set aside</th><th scope="col">Spent</th><th scope="col">Left</th><th scope="col"><span className="sr-only">Details</span></th></tr></thead>
        {groups.map((group,groupIndex)=>{
         const categories=visibleCategories.filter(c=>c.group===group);if(!categories.length&&(query||filter!=='all'))return null;const closed=collapsed.has(group);
         const sum=(key:'assigned'|'spent'|'available')=>categories.reduce((n,c)=>n+t.categories[c.id][key],0);
         return <tbody className={'ledger-group group-'+groupIndex%3} key={group}><tr className="ledger-group-heading"><th scope="rowgroup"><div className="group-heading-name"><button aria-expanded={!closed} onClick={()=>setCollapsed(old=>{const next=new Set(old);if(next.has(group))next.delete(group);else next.add(group);return next;})}><ChevronDown size={14} className={closed?'rotated':''}/><span className="group-index">{String(groupIndex+1).padStart(2,'0')}</span><strong>{group}</strong><span className="group-count">{categories.length}</span></button><button className="category-add-icon" aria-label={'Add subcategory to '+group} data-tooltip="Add subcategory" onClick={()=>{setAdding(group);setCollapsed(old=>{const next=new Set(old);next.delete(group);return next;});}}><Plus size={15}/></button></div></th><td>{fmt(sum('assigned'))}</td><td>{fmt(sum('spent'))}</td><td className={pipView&&sum('available')<0?'pip-negative':undefined}>{fmt(sum('available'))}</td><td/></tr>
          {!closed&&categories.map(c=>{const ct=t.categories[c.id],need=targetNeed(c,ct,month),isNegative=ct.available<0;
           const percent=targetProgress(c,ct,month);
           const description=isNegative?fmt(-ct.available)+' to cover':c.target===0?'No savings goal yet':c.targetPausedMonths?.includes(month)?'Goal paused':need===0?(c.targetType==='balance'&&ct.available<c.target?'On track this month':'Goal met'):c.targetType==='balance'?fmt(need)+' needed this month':fmt(need)+' still needed';
           return <tr className={'ledger-row '+(selected===c.id?'selected':'')} key={c.id}><th scope="row">{pipView?<div className="pip-category-cell"><CategoryIcon category={c}/><div className="ledger-category-copy"><button id={pipView?'category-details-trigger-'+c.id:undefined} className="ledger-category" aria-label={'Details for '+c.name} aria-current={selected===c.id?'true':undefined} onClick={()=>setSelected(c.id)}><span className="ledger-category-title">{c.name}</span>{(c.target>0||isNegative)&&<span className={'ledger-status '+(isNegative?'negative':need>0?'needs-funding':'')}>{c.target>0&&<span className="mini-progress"><i style={{width:Math.min(100,Math.max(0,percent))+'%'}}/></span>}{description}</span>}</button></div></div>:<button id={pipView?'category-details-trigger-'+c.id:undefined} className="ledger-category" aria-label={'Details for '+c.name} onClick={()=>setSelected(c.id)}><CategoryIcon category={c}/><span className="ledger-category-title">{c.name}</span><span className={'ledger-status '+(isNegative?'negative':need>0?'needs-funding':'')}><span className="mini-progress"><i style={{width:Math.min(100,Math.max(0,percent))+'%'}}/></span>{description}</span></button>}</th><td><InlinePlan suspendBlur={appearanceOpen} label={c.name} amount={ct.assigned} currency={b.currency} update={value=>{
            const delta=value-ct.assigned;const date=month===thisMonth()?today():monthEnd(month);
            if(delta>0)commit(allocate(b,'ready',c.id,delta,date),'Plan updated');
            if(delta<0)commit(allocate(b,c.id,'ready',-delta,date),'Plan updated');
           }}/></td><td className="ledger-spent">{fmt(ct.spent)}</td><td><button className={'ledger-available '+(isNegative?'negative-pill':ct.available===0?'zero':'')} aria-label={c.name+' money left: '+fmt(ct.available)} onClick={()=>setSelected(c.id)}>{fmt(ct.available)}</button></td><td><button className="icon-button row-details" aria-label={'Move category money for '+c.name} data-tooltip={isNegative?'Cover the shortfall in '+c.name:'Move money from '+c.name+'. Account balances stay the same.'} onClick={()=>setDialog(isNegative?{type:'allocation',to:c.id,amount:Math.min(Math.max(0,t.ready),-ct.available)}:{type:'allocation',from:c.id})}><ArrowLeftRight size={14}/></button></td></tr>;
          })}
          {!closed&&adding===group&&<InlineCategoryRow columns={pipView?ledgerColumns:5} key={'add-'+group} group={group} save={name=>addCategory(name,group)} cancel={()=>setAdding(null)}/>}
         </tbody>;
        })}
        {visibleCategories.length>0&&<tfoot><tr><th scope="row">Your category totals<span>{visibleCategories.length} categories in this view</span></th><td>{fmt(visibleCategories.reduce((n,c)=>n+t.categories[c.id].assigned,0))}</td><td>{fmt(visibleCategories.reduce((n,c)=>n+t.categories[c.id].spent,0))}</td><td className={pipView&&visibleCategories.reduce((n,c)=>n+t.categories[c.id].available,0)<0?'pip-negative':undefined}>{fmt(visibleCategories.reduce((n,c)=>n+t.categories[c.id].available,0))}</td><td/></tr></tfoot>}
       </table></div>
       {!visibleCategories.length&&<Empty title="No categories found" description={query?'No categories match your search. Try another name.':'No categories in this view. Change the filter or add something new.'}/>}
       <div className="budget-table-footer"><button className="text-button" onClick={()=>setDialog({type:'categorySuggestions'})}><Sparkles size={14}/>Category suggestions</button><span>{wideLedger?'Scroll to see all amounts. Enter saves; Esc cancels.':'Click a Set aside amount to edit. Enter saves; Esc cancels.'}</span></div>
       {cardAccounts.length>0&&<section className="payment-reserves" aria-label="Protected card payment money"><div className="reserve-intro"><ShieldCheck size={18}/><span><strong>Cash set aside for cards</strong><small>This cash is set aside. Card payments do not count as spending.</small></span></div><div className="reserve-items">{cardAccounts.map(a=><button className="reserve-item" key={a.id} onClick={()=>setDialog({type:'allocation',to:'card:'+a.id,amount:Math.min(Math.max(0,t.ready),t.cards[a.id].unbacked)})}><span>{a.name}</span><strong className={t.cards[a.id].reserve<0?'negative':''}>{fmt(t.cards[a.id].reserve)}</strong><Plus size={13}/></button>)}</div><button className="text-button" onClick={()=>navigate('accounts')}>Card details<ArrowUpRight size={15}/></button></section>}
      </section>
      {selectedCategory&&<aside className="context-column"><CategoryDetail c={selectedCategory} b={b} t={t} month={month} open={setDialog} close={()=>{setSelected(null);if(pipView)requestAnimationFrame(()=>document.getElementById('category-details-trigger-'+selectedCategory.id)?.focus({preventScroll:true}));}} showTransactions={()=>{navigate('transactions');setQuery(selectedCategory.name);}}/></aside>}
     </div>
     {pipView&&!initialSnapshot.ownerTest&&<BudgetSharingNote shared={t.shared} currency={b.currency} onReview={openPeople}/>}
     <div className="workspace-footer"><span><ShieldCheck size={13}/> {pipView?'Personal budget':'Your plan can change. That’s the point.'}</span><button className="text-button" onClick={()=>setDialog({type:'help'})}>What do these numbers mean?<ArrowUpRight size={13}/></button></div>
    </>}
    {page==='transactions'&&<Transactions onEditingChange={setTransactionEditing} onPeople={openPeople} editingRef={editingTransaction} b={b} t={t} month={month} onCurrentMonth={()=>setMonth(thisMonth())} query={query} setQuery={setQuery} accountFilter={accountFilter} setAccountFilter={setAccountFilter} open={setDialog} commit={commit} action={action} closeDialog={()=>setDialog(null)}/>}
    {(page==='accounts'||page==='budget'&&!pipView)&&(t.shared.receivable>0||t.shared.owed>0)&&<section className="shared-budget-preview" aria-label="Shared budget balances"><div><span>Friends owe you</span><strong>{fmt(t.shared.receivable)}</strong></div><div><span>You owe</span><strong>{fmt(t.shared.owed)}</strong></div><div><span>Cash set aside for friends</span><strong>{fmt(t.shared.reserved)}</strong></div><p>Money owed to you is included in net worth, but cannot be spent until received. Cash set aside for friends is excluded from Available to plan.</p><button className="text-button" onClick={openPeople}>Review in People</button></section>}
    {page==='accounts'&&<><div className="account-overview"><div><span>CASH YOU HAVE</span><strong>{fmt(t.cash)}</strong></div><div><span>CARD BALANCES OWED</span><strong>{fmt(Object.values(t.cards).reduce((n,c)=>n+c.owed,0))}</strong></div><div><span>NET WORTH</span><strong>{fmt(t.netWorth)}</strong></div></div><div className={'account-grid organized-accounts '+(cardAccounts.length?'has-cards':'')}><section className="account-group"><h2>Cash and investments</h2><div className="account-cash-grid">{b.accounts.filter(a=>a.type!=='credit').map(a=>a.type==='investment'?<InvestmentDetail key={a.id} account={a} budget={b} balance={t.balances[a.id]} open={setDialog} onActivity={()=>navigate('transactions',a.id)}/>:<div className={'account-tile '+a.type} key={a.id}><div className="account-tile-top"><span className="account-symbol"><Landmark size={21}/></span><span className="account-type">{a.type==='savings'?'SAVINGS':'CHECKING'}</span><button className="icon-button" aria-label={'Transactions for '+a.name} onClick={()=>navigate('transactions',a.id)}><ArrowUpRight size={17}/></button></div><h3>{a.name}</h3><span className="account-digits">Manually tracked</span><strong className="account-big-balance">{fmt(t.balances[a.id])}</strong><span className="small muted">Recorded account balance</span><button className="button secondary full" onClick={()=>navigate('transactions',a.id)}>View transactions<ArrowRight size={15}/></button></div>)}<button className="add-account-tile" onClick={()=>setDialog({type:'account'})}><span><Plus size={26}/></span><strong>Add an account</strong><small>Record a bank, cash, credit or investment account.</small></button></div></section>{cardAccounts.length>0&&<section className="account-group"><h2>Credit cards</h2><div className="account-credit-grid">{cardAccounts.map(a=><CardDetail key={a.id} a={a} b={b} t={t} month={month} open={setDialog}/>)}</div></section>}</div><div className="privacy-note"><ShieldCheck size={19}/><div><strong>You stay in control.</strong><p>These balances come from your opening balances and recorded transactions. No bank credentials, no connections, no automatic access.</p></div></div></>}
    {page==='insights'&&<Insights b={b} t={t} month={month} totalLeft={totalLeft} act={a=>{if(a.kind==='category'){navigate('budget');setSelected(a.id);}else if(a.kind==='accounts')navigate('accounts');else setDialog(a.kind==='plan'?{type:'plan'}:a.kind==='shortfall'?{type:'cashShortfalls'}:{type:'transaction'});}} openCategory={c=>{navigate('budget');setSelected(c.id);}}/>}
    {page==='subscriptions'&&<SubscriptionsPage b={b} available={supportsSubscriptions} busy={saving||!!saveError} readOnly={!supportsSubscriptions||!initialSnapshot.ownerTest&&!billing?.canEdit} open={setDialog} commit={commit} action={action}/>}
   </>}
   </main>
  </div>
  {learningWelcome&&<Modal title="Learn SpentOn" className="modal-standard learning-welcome-modal" onClose={()=>setLearningWelcome(false)}><div className="form-body"><LearningWelcome controller={onboarding} existing onStart={()=>setLearningWelcome(false)} onDismiss={()=>setLearningWelcome(false)}/></div></Modal>}
  {dialog&&<Dialogs key={dialog.type+(dialog.type==='category'?dialog.category?.id??'':dialog.type==='allocation'?(dialog.from??'')+':'+(dialog.to??''):dialog.type==='transaction'?dialog.entry?.id??'new':'')} dialog={dialog} b={b} t={t} month={month} onClose={()=>setDialog(null)} commit={commit} open={setDialog} recovery={null} resetBlockedReason={budgetResetRestriction(b,plannedShareCount)} onWorkspace={openWorkspace} onLearn={onboarding.state&&onboarding.state.status!=='completed'?()=>{setDialog(null);openLearning();}:undefined} learningLabel={onboarding.state?.status==='offered'?'Start guide':'Continue guide'}/>}
  {appearanceOpen&&<AppAppearanceDialog value={appearance} onChange={updateAppearance} remembered={remembered} onClose={()=>setAppearanceOpen(false)}/>}
  {toast&&<div className={'toast '+toastTone} role={toastTone==='error'?'alert':'status'}>{toastTone==='success'?<CheckCircle2 size={18}/>:toastTone==='error'?<CircleAlert size={18}/>:<CircleHelp size={18}/>}<span>{toast}</span><button className="icon-button" aria-label="Dismiss notification" onClick={()=>notify('')}><X size={15}/></button></div>}
 </div>;
}

function CategoryDetail({c,b,t,month,open,close,showTransactions}:{c:Category;b:Budget;t:Totals;month:string;open:(d:DialogState)=>void;close:()=>void;showTransactions:()=>void}){
 const ct=t.categories[c.id],fmt=(n:number)=>money(n,b.currency),need=targetNeed(c,ct,month);
 return <div className="context-card category-detail"><div className="aside-heading"><span className="context-eyebrow">CATEGORY DETAILS</span><button className="icon-button" aria-label="Close category details" onClick={close}><X size={16}/></button></div><button className="category-icon-edit" aria-label={'Change icon for '+c.name} onClick={()=>open({type:'category',category:c})}><CategoryIcon category={c} size={23}/><Pencil size={12}/></button><h2 tabIndex={-1}>{c.name}</h2><span className={'detail-amount '+(ct.available<0?'negative':'')}>{fmt(ct.available)}</span><span className="muted small">{ct.available<0?'Amount to cover':'Left in this category'}</span>
  <div className="detail-breakdown"><div><span>Carried into this month</span><strong>{fmt(ct.carry)}</strong></div><div><span>{ct.assigned<0?'Moved out this month':'Set aside this month'}</span><strong>{fmt(Math.abs(ct.assigned))}</strong></div><div><span>Purchases minus refunds</span><strong>{fmt(ct.spent)}</strong></div><div className="breakdown-total"><span>Cash still in this category</span><strong>{fmt(ct.cash)}</strong></div>{ct.unfunded>0&&<div className="negative"><span>Card purchases still needing cash</span><strong>{fmt(ct.unfunded)}</strong></div>}</div>
  <button className="button primary full" onClick={()=>open({type:'allocation',to:c.id,amount:Math.min(Math.max(0,t.ready),need||Math.max(0,-ct.available))})}>Set money aside<Plus size={16}/></button><div className="button-row"><button className="text-button" data-tooltip={'Move money from '+c.name+'. Account balances stay the same.'} onClick={()=>open({type:'allocation',from:c.id})}><ArrowLeftRight size={14}/>Move category money</button><button className="text-button" onClick={()=>open({type:'category',category:c})}><Pencil size={14}/>Edit category</button><button className="text-button" onClick={()=>open({type:'goal',category:c})}><Target size={14}/>{c.target>0?'Edit savings goal':'Set a savings goal'}</button><button className="text-button" onClick={showTransactions}>Activity<ArrowUpRight size={14}/></button></div>
  {c.target===0&&<div className="category-goal-empty"><strong>Optional savings goal</strong><p>Add an amount and a timeline to see a suggested monthly contribution.</p></div>}
  {c.target>0&&<div className="category-target"><span><Target size={16}/>{targetSummary(c,b.currency,month)}</span><Progress value={targetProgress(c,ct,month)} label="Category target progress"/><p>{c.targetPausedMonths?.includes(month)?'This target resumes in an unpaused month.':need>0?fmt(need)+' more suggested this month.':'The suggested contribution is covered.'}</p></div>}
  <BudgetHistory budget={b} categoryId={c.id} month={month} onOpenTransaction={entry=>entry.kind==='refund'?open({type:'refund',purchase:b.entries.find(e=>e.id===entry.refundOf)!,entry}):open({type:'transaction',entry})}/>
 </div>;
}

function CardDetail({a,b,t,month,open}:{a:Account;b:Budget;t:Totals;month:string;open:(d:DialogState)=>void}){
 const [explain,setExplain]=useState(false);const c=t.cards[a.id],fmt=(n:number)=>money(n,b.currency);
 const funded=c.statementGap===0;const isStatement=!!a.statement;const paymentFunding=Math.max(0,-c.reserve,isStatement?c.statementGap:c.unbacked);
 return <section className="context-card card-detail"><div className="context-eyebrow"><ShieldCheck size={16}/>CARDS, WITHOUT THE GUESSWORK</div><div className="mini-credit-card"><div className="mini-card-top"><span>{a.name}</span><span className="card-chip"><i/><i/></span></div><strong>{fmt(c.owed)}</strong><div className="mini-card-bottom"><span>Current balance owed</span><span>Manual card</span></div><span className="card-decoration" aria-hidden="true"/></div>
  {isStatement?<><div className="card-facts"><div><span>Statement still to pay<button className="icon-button tiny" aria-label="Edit card statement" onClick={()=>open({type:'statement',account:a})}><Pencil size={11}/></button></span><strong>{fmt(c.statementRemaining)}</strong></div><div><span>Cash set aside for this card</span><strong className="green-text">{fmt(c.reserve)}</strong></div></div><Progress value={c.statementRemaining?100*Math.max(0,c.reserve)/c.statementRemaining:100} label="Cash set aside for the statement" tone={funded?'green':'amber'}/>
   <div className={'card-guidance '+(funded?'funded':'')}><span>{funded?<Check size={15}/>:<span className="guidance-dot"/>}<strong>{c.reserve<0?fmt(-c.reserve)+' is needed to cover this card payment.':c.statementRemaining===0?'This statement is paid.':funded?'Cash is set aside for this statement.':fmt(c.statementGap)+' more is needed for this statement.'}</strong></span><p>{c.reserve<0?'The card payment is recorded. Set cash aside to cover it.':c.statementRemaining===0?'Cash for newer purchases stays set aside.':'Due '+shortDate(a.statement!.due)+' · '+fmt(c.minimumRemaining)+' minimum remaining'}</p></div>
  </>:<div className="no-statement"><p>Add the bill amount and due date from your issuer to see what’s needed for your next payment.</p><button className="text-button" onClick={()=>open({type:'statement',account:a})}>Add statement details<Plus size={14}/></button></div>}
  {paymentFunding>0?<button className="button primary full" onClick={()=>open({type:'allocation',to:'card:'+a.id,amount:Math.min(Math.max(0,t.ready),paymentFunding)})}>Set aside cash for this payment<ArrowRight size={15}/></button>:<button className="button primary full" onClick={()=>open({type:'transaction',kind:'payment',toAccountId:a.id})}>Record card payment<ArrowRight size={15}/></button>}
  <section className={'card-backing '+(c.unbacked===0?'backed':'needs-backing')} aria-label={'Cash set aside for '+a.name}><div><span>Card debt still needing cash</span><strong>{fmt(c.unbacked)}</strong></div><p>{c.unbacked===0?'Cash is set aside for all recorded card debt, including newer purchases.':c.statementRemaining===0?'Your last statement is paid. Other card debt still needs cash.':c.statementGap===0?'Cash is set aside for your statement. Other card debt still needs cash.':'This includes all recorded card debt, regardless of which statement it appears on.'}</p>{c.unbacked>0&&<><p>{t.ready>=c.unbacked?'Available to plan can cover this. Set it aside before planning other spending.':'Use available category money. If that is not enough, record new income when it arrives.'}</p><button className="button secondary full" onClick={()=>open({type:'allocation',to:'card:'+a.id,amount:Math.min(Math.max(0,t.ready),Math.max(c.unbacked,-c.reserve))})}>Set aside cash<ArrowRight size={15}/></button></>}</section>
  <CardActivity budget={b} account={a} month={month}/>
  <p className="card-timing-note">Purchases count as spending in the month you buy. Paying a later statement does not count them again. Figures follow the selected budget month.</p>
  <button className="explanation-toggle" aria-expanded={explain} onClick={()=>setExplain(!explain)}><CircleHelp size={14}/>Why are these amounts different?<ChevronDown size={14} className={explain?'turned':''}/></button>
  {explain&&<div className="card-explanation"><p><strong>Balance owed</strong> includes opening debt and all recorded card activity.</p><p><strong>Statement still to pay</strong> is your entered bill less recorded payments since it closed. Newer purchases can wait for the next statement.</p><p><strong>Cash set aside</strong> comes from category cash used for card purchases and cash you set aside. It stays in your bank account.</p><div><span>Card debt still needing cash</span><strong>{fmt(c.unbacked)}</strong></div>{c.credit>0&&<div><span>Credit held on this card</span><strong>{fmt(c.credit)}</strong></div>}<button className="text-button" onClick={()=>open({type:'transaction',kind:'payment',toAccountId:a.id})}>Record card payment<ArrowUpRight size={14}/></button></div>}
 </section>;
}


function InlineCategoryRow({group,save,cancel,columns=5}:{group:string;save:(name:string)=>void;cancel:()=>void;columns?:number}){
 const [name,setName]=useState('');const [error,setError]=useState('');
 return <tr className="category-add-row editing"><td colSpan={columns}>
  <form className="inline-category-form" aria-label={'New subcategory in '+group} onSubmit={e=>{e.preventDefault();const trimmed=name.trim();if(!trimmed){setError('Enter a subcategory name.');return;}try{save(trimmed);}catch(err){setError(err instanceof Error?err.message:'Could not add this subcategory.');}}}>
   <Plus size={16}/><input aria-label="Subcategory name" placeholder={'Subcategory in '+group} value={name} onChange={e=>{setName(e.target.value);setError('');}} maxLength={80} required autoFocus onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();cancel();}}}/><button type="submit" className="button primary">Add</button><button type="button" className="icon-button" aria-label="Cancel adding category" onClick={cancel}><X size={16}/></button>
  </form>{error&&<p className="inline-category-error" role="alert">{error}</p>}
 </td></tr>;
}

function InlinePlan({label,amount,currency,update,suspendBlur=false}:{label:string;amount:number;currency:string;update:(value:number)=>void;suspendBlur?:boolean}){
 const [editing,setEditing]=useState(false),[draft,setDraft]=useState(''),[problem,setProblem]=useState('');
 const finished=useRef(false),problemId=useId();
 function save(){
  if(finished.current)return;
  try{const next=cents(draft);if(next<0)throw new Error('Enter zero or more.');if(next!==amount)update(next);finished.current=true;setEditing(false);}
  catch(cause){const message=cause instanceof Error?cause.message:'Your plan could not be updated.';setProblem(message);}
 }
 if(!editing)return <button className="inline-plan" data-tooltip={amount<0?'More money moved out than was added this month. This can use money carried over from earlier months.':'Money added this month, minus money moved out.'} aria-label={'Edit amount set aside for '+label} onClick={()=>{setDraft((amount/100).toFixed(2));setProblem('');finished.current=false;setEditing(true);}}>{money(Math.abs(amount),currency)}{amount<0&&<small className="moved-out-label">moved out</small>}<Pencil size={11}/></button>;
 return <div className="inline-plan-draft"><AmountInput className="inline-plan-input" aria-label={'Amount set aside for '+label} aria-invalid={!!problem} aria-describedby={problem?problemId:undefined} inputMode="decimal" value={draft} autoFocus onFocus={e=>e.currentTarget.select()} onChange={e=>{setDraft(e.target.value);setProblem('');}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();save();}if(e.key==='Escape'){e.preventDefault();finished.current=true;setEditing(false);}}} onBlur={()=>{if(!suspendBlur)save();}}/>{problem&&<small id={problemId} role="alert">{problem}</small>}</div>;
}
