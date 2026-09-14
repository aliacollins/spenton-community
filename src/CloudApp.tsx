import GroupInvitation from './GroupInvitation';
import {clearSharingDrafts} from './sharing-drafts';
import ShareInvitation from './ShareInvitation';
import Select from './Select';
import AmountInput from './AmountInput';
import {PipGuideProvider} from './PipGuidance';
import {useOnboarding,onboardingErrorReason} from './onboarding-client';
import type {OnboardingController} from './onboarding-client';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';
import App from './App';
import { blankBudget, cents, id, today, validateBudget } from './engine';
import type { Budget } from './engine';
import { api, CloudError, getBudget, validateSnapshot } from './cloud';
import type { BudgetSummary, CloudBudget, CloudUser, Usage } from './cloud';
import { Field, Modal } from './ui';
import './cloud.css';
import OnboardingGuide from './OnboardingGuide';
import StarterCategories, { starterCategories } from './StarterCategories';
import { BillingDialog,AdminPanel } from './AccessPanel';
import Workspace from './Workspace';
import { AuthCompletion } from './SocialSignIn';
import { AuthForm } from './AuthForm';
import { budgetsFromBackup,budgetImportIssue } from './backup';
import CookieSettings from './CookieSettings';
import PrivacyPage from './PrivacyPage';
import TermsPage from './TermsPage';
import { AccountAction, AccountPrivacy } from './AccountPrivacy';
import type { BillingStatus } from './AccessPanel';
import SelfHostedPolicy,{selfHostedPage} from './SelfHostedPolicy';
import LoadingState from './LoadingState';

const PipSetup=lazy(()=>import('./PipSetup'));
const message=(error:unknown)=>error instanceof Error?error.message:'This request could not be completed.';

function Brand(){return <a className="cloud-brand" href="/landing/"><img src="/brand/spenton-symbol.svg" alt=""/><span>SpentOn</span></a>;}
function Frame({children,wide=false}:{children:ReactNode;wide?:boolean}){return <main className={'cloud-page '+(wide?'cloud-wide':'')}><header><Brand/><span><ShieldCheck size={15}/>Your budget. Your choice.</span></header>{children}</main>;}



function CreateBudget({onCreated,onClose,onboarding}:{onCreated:(snapshot:CloudBudget)=>void;onClose:()=>void;onboarding:OnboardingController}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[imported,setImported]=useState<Budget|null>(null),[reviewed,setReviewed]=useState(false);
 const pending=useRef<{budget:Budget;reviewed:true;mutationId:string}|null>(null);
 const [currency,setCurrency]=useState<Budget['currency']>('USD');
 const [backupChoices,setBackupChoices]=useState<Budget[]>([]);
 const importIssue=imported?budgetImportIssue(imported):null;
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;setBusy(true);setError('');
  const form=new FormData(event.currentTarget);
  onboarding.event('budget','action');
  try{
   let budget:Budget;
   if(!pending.current){
   if(imported){if(importIssue)throw new Error(importIssue);if(!reviewed)throw new Error('Review the backup and confirm before importing it into your account.');budget=imported;}
   else{
    budget={...blankBudget(String(form.get('currency')) as Budget['currency']),name:String(form.get('name')).trim()};
    const opening=cents(String(form.get('opening')));if(opening<0)throw new Error('Start this cash account with a balance of zero or more.');
    budget.categories=starterCategories(form.getAll('starter').map(String));
    budget.accounts=[{id:id(),name:String(form.get('account')).trim(),type:String(form.get('accountType')) as 'checking'|'savings',opening,date:today(),lastFour:''}];
   }
   pending.current={budget:validateBudget(budget),reviewed:true,mutationId:crypto.randomUUID()};
   }
   const result=validateSnapshot(await api<CloudBudget>('/budgets',{method:'POST',body:pending.current}));onCreated(result);
  }catch(e){onboarding.event('budget','blocked',onboardingErrorReason(e));if(e instanceof CloudError&&e.status>=400&&e.status<500)pending.current=null;setError(message(e)+(pending.current?' Retry to confirm the same budget creation.':''));}finally{setBusy(false);}
 }
 return <Modal title={imported?'Review your backup':'Create a budget'} eyebrow="A FRESH START" className="budget-setup-modal" onClose={busy?()=>{}:onClose}>
  <form className="budget-setup-form" onSubmit={submit} onInvalidCapture={()=>onboarding.event('budget','blocked','input')}>
   <div className="form-body budget-setup-body">
    <fieldset className="cloud-create-fields" disabled={busy||!!pending.current}>
     {imported?<div className="budget-import-review">{backupChoices.length>1&&<Field label="Budget to import"><Select aria-label="Budget to import" value={backupChoices.indexOf(imported)} onChange={event=>{setImported(backupChoices[Number(event.target.value)]);setReviewed(false);}}>{backupChoices.map((budget,index)=><option key={index} value={index}>{budget.name}</option>)}</Select></Field>}<p><strong>{imported.name}</strong> · {imported.currency}</p><p className="muted">{imported.accounts.length} accounts, {imported.categories.length} categories, and {imported.entries.length} records. This creates a separate personal budget. Account settings, Cloud access, contacts, shared relationships and receipt images are not imported.</p>{importIssue&&<p className="form-error" role="alert">{importIssue}</p>}<label className="check-label"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} required/><span>I reviewed this backup and want to import it into my account.</span></label><button className="text-button" type="button" onClick={()=>{setImported(null);setReviewed(false);}}>Start with a fresh budget instead</button></div>:<>
      <div className="budget-setup-details">
       <section className="budget-setup-section" aria-labelledby="setup-budget-heading">
        <div className="setup-step"><span className="step-number">1</span><div><h3 id="setup-budget-heading">Make it yours</h3><p>One plan for your everyday money.</p></div></div>
        <div className="field-row budget-identity-row"><Field label="Budget name"><input name="name" defaultValue="My everyday budget" maxLength={80} required/></Field><Field label="Currency"><Select name="currency" aria-label="Budget currency" value={currency} onChange={e=>setCurrency(e.target.value as Budget['currency'])}>{['USD','INR','EUR','GBP','CAD','AUD'].map(c=><option key={c}>{c}</option>)}</Select></Field></div>
       </section>
       <section className="budget-setup-section" aria-labelledby="setup-account-heading">
        <div className="setup-step"><span className="step-number">2</span><div><h3 id="setup-account-heading">Start with one account</h3><p>A bank account or cash wallet you already use.</p></div></div>
        <Field label="Account nickname"><input name="account" defaultValue="Everyday checking" placeholder={currency==='INR'?'For example, HDFC salary':'For example, Salary account'} maxLength={80} required/></Field>
        <Field label="Account type"><Select name="accountType" defaultValue="checking"><option value="checking">Current / checking / cash wallet</option><option value="savings">Savings account</option></Select></Field>
        <Field label="Current cash balance"><div className="amount-input setup-opening-balance"><span>{currency}</span><AmountInput name="opening" defaultValue="0.00" inputMode="decimal" required aria-label="Current cash balance"/></div></Field>
        <p className="setup-account-note">Enter the money in this account today. You can add more accounts and credit cards later.</p>
       </section>
      </div>
      <section className="budget-setup-categories" aria-labelledby="setup-categories-heading">
       <div className="setup-step"><span className="step-number">3</span><div><h3 id="setup-categories-heading">Give your money a place</h3><p>Choose the categories that fit your life.</p></div></div>
       <StarterCategories compact/>
      </section>
     </>}
    </fieldset>
    {error&&<p role="alert" className="form-error">{error}</p>}
   </div>
   <div className="modal-footer">
    {!imported&&<label className={'setup-import-link'+(busy||pending.current?' disabled':'')}>Import a SpentOn backup<input type="file" accept=".json,application/json" disabled={busy||!!pending.current} onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>64_000_000)throw new Error('Use a backup smaller than 64 MB.');const choices=budgetsFromBackup(JSON.parse(await file.text()));setBackupChoices(choices);setImported(choices[0]);setReviewed(false);setError('');}catch(err){setError(message(err));}finally{e.target.value='';}}}/></label>}
    <div className="setup-actions"><button type="button" className="button ghost" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" disabled={busy||!!importIssue}>{busy?'Creating…':imported?'Import reviewed budget':'Create my budget'}<ArrowRight size={17}/></button></div>
   </div>
  </form>
 </Modal>;
}

export default function CloudApp(){const query=new URLSearchParams(location.search);return <>{location.pathname==='/terms'?(selfHostedPage?<SelfHostedPolicy terms/>:<TermsPage/>):location.pathname==='/privacy'?(selfHostedPage?<SelfHostedPolicy/>:<PrivacyPage/>):query.has('group-invite')?<GroupInvitation/>:query.has('share-invite')?<ShareInvitation/>:query.has('account-action')?<AccountAction/>:query.has('auth')?<AuthCompletion/>:<CloudWorkspace/>}<footer className="privacy-links"><a href="/privacy">Privacy &amp; cookies</a><a href="/terms">Terms of use</a><CookieSettings/></footer></>;}

function CloudWorkspace(){
 const [user,setUser]=useState<CloudUser|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [requestedSignup,setRequestedSignup]=useState(()=>location.pathname==='/app'&&new URLSearchParams(location.search).get('signup')==='1');
 const onboarding=useOnboarding(user?.id);
 const [budgets,setBudgets]=useState<BudgetSummary[]>([]),[snapshot,setSnapshot]=useState<CloudBudget|null>(null),[usage,setUsage]=useState<Usage|null>(null);
 const [manualCreate,setManualCreate]=useState(false);
 const [testing,setTesting]=useState(false);
 const [creating,setCreating]=useState(false),[busy,setBusy]=useState(false),[coupon,setCoupon]=useState(''),[notice,setNotice]=useState(''),[reauth,setReauth]=useState(false);
 const [openingBudget,setOpeningBudget]=useState<string|null>(null),[refreshing,setRefreshing]=useState(false);
 const [guide,setGuide]=useState(false),[showAccount,setShowAccount]=useState(()=>new URLSearchParams(location.search).get('account')==='settings');
 const [billing,setBilling]=useState<BillingStatus|null>(null),[showBilling,setShowBilling]=useState(false);
 const savedSetup=useRef<CloudBudget|null>(null),setupMutation=useRef<string|null>(null);
 const adminRoute=window.location.pathname==='/admin'||window.location.pathname.startsWith('/admin/');
 async function refreshWorkspace(autoOpen=false){
  const [list,limits,access]=await Promise.all([api<{budgets:BudgetSummary[]}>('/budgets'),api<Usage>('/usage'),api<BillingStatus>('/billing')]);
  setBudgets(list.budgets);setUsage(limits);setBilling(access);
  if(autoOpen&&list.budgets.length===0&&!adminRoute){const progress=await onboarding.refresh();if(progress?.cohort==='new'&&progress.status!=='completed')setCreating(true);}
  if(autoOpen&&list.budgets.length===1&&!adminRoute)setSnapshot(await getBudget(list.budgets[0].id));
 }
 async function initialize(){setLoading(true);setError('');try{const response=await api<{user:CloudUser}>('/auth/me');setRequestedSignup(false);setUser(response.user);await refreshWorkspace(true);}catch(e){if(e instanceof CloudError&&e.status===401)setUser(null);else setError(message(e));}finally{setLoading(false);}}
 useEffect(()=>{
  // Consume this display-only entry hint once. It must not turn a later
  // sign-out or expired-session recovery into a registration flow.
  const url=new URL(location.href);
  if(url.searchParams.has('signup')){url.searchParams.delete('signup');history.replaceState(history.state,'',url.pathname+url.search+url.hash);}
  void initialize();
 },[]);
 useEffect(()=>{if(!user)return;const refresh=()=>{if(document.visibilityState==='visible')void api<BillingStatus>('/billing').then(setBilling).catch(()=>{});};const timer=setInterval(refresh,60000);window.addEventListener('focus',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};},[user?.id]);
 async function signedIn(next:CloudUser){setRequestedSignup(false);setUser(next);setLoading(true);setError('');try{await refreshWorkspace(true);}catch(e){setError(message(e));}finally{setLoading(false);}}
 async function workspace(){if(testing){setTesting(false);setSnapshot(null);setCreating(false);window.location.assign('/admin?section=testing');return;}setSnapshot(null);setError('');setRefreshing(true);try{await refreshWorkspace();}catch(e){setError(message(e));}finally{setRefreshing(false);}}
 async function signOut(){setBusy(true);try{await api('/auth/logout',{method:'POST'});if(user)clearSharingDrafts(user.id);setSnapshot(null);setBudgets([]);setUsage(null);setBilling(null);setUser(null);setTesting(false);setCreating(false);setNotice('');return true;}catch(e){setError(message(e));return false;}finally{setBusy(false);}}
 if(loading)return <Frame wide><LoadingState className="cloud-loading" layout="page" label="Opening your workspace" detail="Checking your sign-in and loading your saved budgets."/></Frame>;
 if(user&&!usage&&error)return <Frame><section className="cloud-card cloud-service-error"><h1>Could not open your workspace</h1><p role="alert">{error}</p><button className="button primary" onClick={()=>void initialize()}>Try connecting again</button></section></Frame>;
 if(!user)return <Frame><section className="cloud-auth auth-layout"><div className="auth-story"><span className="cloud-eyebrow">BUDGET WITH SPENTON</span><h2>Plan your money.<br/>Keep your own budget.</h2><p>Plan for bills, track spending and split shared expenses. Keep repayments separate from income, with Pip to guide your setup.</p><div className="auth-pip"><img src="/brand/pip-welcome-small.png" alt="Pip, your little coin pouch companion" width="230" height="230"/></div><div className="auth-story-footer"><strong>Your budgets are private.</strong><a href="/privacy">Read our privacy notice <ArrowUpRight size="1em" aria-hidden="true" style={{verticalAlign:"middle"}}/></a></div></div><div className="cloud-card auth-card"><AuthForm initialRegister={requestedSignup} onSignedIn={next=>void signedIn(next)}/>{error&&<div className="cloud-service-error" role="alert"><p>{error}</p><button className="text-button" onClick={()=>void initialize()}>Try connecting again</button></div>}</div></section></Frame>;
 if(adminRoute&&!testing)return <Frame wide>{user.isAdmin?<Suspense fallback={<LoadingState layout="page" label="Opening owner administration" detail="Loading your owner tools."/>}><AdminPanel onReplay={()=>{setManualCreate(false);savedSetup.current=null;setupMutation.current=null;setSnapshot(null);setTesting(true);setCreating(true);}} onTestBudget={next=>{setSnapshot(next);setTesting(true);setCreating(false);}} onClose={()=>{window.location.assign('/app');}}/></Suspense>:<section className="cloud-card"><LockKeyhole size={30}/><h1>Owner access required</h1><p>This account cannot open owner administration.</p><a className="button secondary" href="/app">Return to your budgets</a></section>}</Frame>;
 if(creating&&(testing&&user.isAdmin||!manualCreate&&budgets.length===0&&onboarding.state?.cohort==='new'&&(onboarding.state.status!=='completed'||savedSetup.current)))return <><Suspense fallback={<Frame wide><LoadingState layout="page" label="Opening your setup guide" detail="Pip will help you set up your first budget."/></Frame>}><PipSetup preview={false} onImport={testing?undefined:()=>setManualCreate(true)} testMode={testing} onFeedback={testing?async answers=>{if(!savedSetup.current)throw new Error('Finish saving the test budget first.');await api('/owner-tests/'+savedSetup.current.id+'/feedback',{method:'POST',body:answers});}:undefined} onClose={()=>{setCreating(false);if(testing)setTesting(false);}} onSave={async budget=>{setupMutation.current??=crypto.randomUUID();try{savedSetup.current=validateSnapshot(await api<CloudBudget>(testing?'/owner-tests':'/budgets',{method:'POST',body:{budget,reviewed:true,mutationId:setupMutation.current,...(testing?{}:{completeSetup:true})}}));}catch(e){if(e instanceof CloudError&&e.status===401)setReauth(true);throw e;}}} onComplete={()=>{const saved=savedSetup.current;if(!saved)return;setCreating(false);setSnapshot(saved);savedSetup.current=null;setupMutation.current=null;void onboarding.refresh();void refreshWorkspace().catch(e=>setError(message(e)));}}/></Suspense>{reauth&&<Modal title="Restore your session" onClose={()=>setReauth(false)}><div className="form-body"><AuthForm existingUser={user} onSignedIn={next=>{setUser(next);setReauth(false);}}/></div></Modal>}</>;
 const appOnboarding=testing?{...onboarding,state:null,refresh:async()=>null,command:async()=>false,event:()=>{}}:onboarding;
 if(snapshot)return <><div inert={showBilling||showAccount||undefined}><PipGuideProvider controller={appOnboarding}><App onboarding={appOnboarding} key={snapshot.id} initialSnapshot={snapshot} user={user} billing={billing} onManagePlan={()=>setShowBilling(true)} onWorkspace={()=>void workspace()} onAccount={()=>setShowAccount(true)} onSignOut={signOut} onReauthenticate={()=>setReauth(true)}/></PipGuideProvider></div>{showBilling&&billing&&<BillingDialog status={billing} user={user} onUpdate={setBilling} onClose={()=>setShowBilling(false)}/>}{showAccount&&<AccountPrivacy user={user} onClose={()=>{setShowAccount(false);void onboarding.refresh();}}/>} {reauth&&<Modal title="Restore your session" onClose={()=>setReauth(false)}><div className="form-body"><AuthForm existingUser={user} onSignedIn={next=>{setUser(next);setReauth(false);}}/></div></Modal>}</>;
 return <>
  <div inert={showBilling||showAccount||undefined}><Workspace onboarding={onboarding} user={user} budgets={budgets} usage={usage} billing={billing} busy={busy||refreshing} openingBudget={openingBudget} refreshing={refreshing} error={error} coupon={coupon} notice={notice}
   onOpen={async budgetId=>{if(busy||refreshing)return;setBusy(true);setOpeningBudget(budgetId);setError('');try{setSnapshot(await getBudget(budgetId));}catch(e){setError(message(e));}finally{setBusy(false);setOpeningBudget(null);}}}
   onCreate={()=>{setManualCreate(false);setCreating(true);if(onboarding.state?.cohort==='new'&&onboarding.state.status==='offered')void onboarding.command({operation:'start',experience:'beginner',analyticsConsent:false});}} onAccount={()=>setShowAccount(true)} onManagePlan={()=>setShowBilling(true)} onSignOut={()=>void signOut()} onRefresh={()=>void workspace()} onGuide={()=>setGuide(true)} onCouponChange={setCoupon}
   onRedeem={async event=>{event.preventDefault();if(busy)return;setBusy(true);setError('');setNotice('');try{const result=await api<{usage:Usage;replayed:boolean}>('/coupons/redeem',{method:'POST',body:{code:coupon.trim()}});setUsage(result.usage);setBilling(await api<BillingStatus>('/billing'));setCoupon('');setNotice(result.replayed?'This coupon was already applied to your account.':'Coupon applied to your account.');}catch(e){setError(message(e));}finally{setBusy(false);}}}
  /></div>
  {showBilling&&billing&&<BillingDialog status={billing} user={user} onUpdate={setBilling} onClose={()=>setShowBilling(false)}/>}
  {showAccount&&<AccountPrivacy user={user} onClose={()=>{setShowAccount(false);void onboarding.refresh();}}/>}
  {guide&&<OnboardingGuide onClose={()=>setGuide(false)} onStart={!budgets.length?()=>{setGuide(false);setCreating(true);}:undefined}/>}
  {creating&&<PipGuideProvider controller={onboarding}><CreateBudget onboarding={onboarding} onClose={()=>setCreating(false)} onCreated={next=>{setCreating(false);setSnapshot(next);void onboarding.refresh();void refreshWorkspace().catch(e=>setError(message(e)));}}/></PipGuideProvider>}
 </>;
}
