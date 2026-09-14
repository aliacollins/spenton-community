import {accountName} from './local-account';
import {LearningWelcome,OnboardingProblem} from './OnboardingJourney';
import type {OnboardingController} from './onboarding-client';
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Cloud, Gift, KeyRound, LogOut, Plus, ShieldCheck, Wallet } from 'lucide-react';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { BudgetSummary, CloudUser, Usage } from './cloud';
import type { BillingStatus } from './AccessPanel';
import { Field, Modal } from './ui';
import SocialSignIn from './SocialSignIn';
import './workspace.css';
import {LoadingIndicator} from './LoadingState';

type Props = {
 onboarding:OnboardingController;
 user:CloudUser; budgets:BudgetSummary[]; usage:Usage|null; billing:BillingStatus|null;
 busy:boolean; openingBudget:string|null; refreshing:boolean; error:string; coupon:string; notice:string;
 onOpen:(id:string)=>void; onCreate:()=>void; onManagePlan:()=>void; onSignOut:()=>void;
 onRefresh:()=>void; onAccount:()=>void; onGuide:()=>void; onCouponChange:(value:string)=>void;
 onRedeem:(event:FormEvent<HTMLFormElement>)=>void;
};
const dateLabel=(value:string|null)=>value?new Date(value).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}):'';
function updatedLabel(value:string){
 const date=new Date(value);
 return date.toDateString()===new Date().toDateString()?'Updated today':'Updated '+dateLabel(value);
}

export default function Workspace({onboarding,user,budgets,usage,billing,busy,openingBudget,refreshing,error,coupon,notice,onOpen,onCreate,onManagePlan,onSignOut,onRefresh,onAccount,onGuide,onCouponChange,onRedeem}:Props){
 const [methods,setMethods]=useState(false),[practice,setPractice]=useState(false);
 const exampleButton=useRef<HTMLButtonElement>(null);
 const closePractice=()=>{setPractice(false);requestAnimationFrame(()=>exampleButton.current?.focus());};
 const full=!!usage&&usage.budgetCount>=usage.budgetLimit;
 const canCreate=!busy&&!!billing?.canEdit&&!full;
 const trial=billing?.state==='trial';
 const empty=budgets.length===0;
 const resume=onboarding.state?.cohort==='new'&&['active','paused'].includes(onboarding.state.status)&&!!onboarding.state.budgetId;
 return <main className={'workspace-page workspace-picker'+(empty?' workspace-new':'')}><div className="workspace-container">
  <header className="workspace-header">
   <a className="cloud-brand" href="/landing/"><img src="/brand/spenton-symbol.svg" alt=""/><span>Spent<span className="workspace-brand-accent">On</span></span></a>
   <div className="workspace-account"><span className="workspace-identity"><span className="workspace-user-avatar" aria-hidden="true">{user.email.charAt(0).toUpperCase()}</span><span className="workspace-user-email">{accountName(user.email)}</span></span><button className="workspace-signin-methods" onClick={onAccount}><ShieldCheck size={15}/>Account &amp; privacy</button><button className="workspace-signin-methods" onClick={()=>setMethods(true)}><KeyRound size={15}/>Sign-in methods</button><button className="workspace-signout" disabled={busy} onClick={onSignOut}><LogOut size={15}/><span>Sign out</span></button></div>
  </header>

  <section className="workspace-welcome"><div><span className="workspace-eyebrow">YOUR PERSONAL SPACE</span><h1>{empty?'Your money, with a plan.':'Your budgets.'}</h1><p>{empty?'A simple place to decide what your money is for.':'Open a budget or create one.'}</p></div>{!empty&&<button className="button primary workspace-create" aria-label="Create budget" disabled={!canCreate} onClick={onCreate}><Plus size={18}/>Create budget</button>}</section>
  {error&&<div className="warning-banner workspace-error" role="alert"><p>{error}</p><button className="button secondary" onClick={onRefresh}>Refresh workspace</button></div>}

  <div className="workspace-layout">
   <section className="workspace-budgets" aria-labelledby="workspace-budgets-title">
    <div className="workspace-section-title"><h2 id="workspace-budgets-title">{empty?'Your first budget':'Saved budgets'}</h2>{refreshing?<LoadingIndicator label="Refreshing budgets"/>:usage&&<span className="workspace-budget-count">{usage.budgetCount}<span>of {usage.budgetLimit} used</span></span>}</div>
    <div className="workspace-budget-list" aria-busy={refreshing}>
     {budgets.map((budget,index)=><button className={'workspace-budget '+(index===0?'workspace-budget-recent':'')} aria-label={'Open '+budget.name} key={budget.id} disabled={busy} onClick={()=>onOpen(budget.id)}>
      <span className="workspace-wallet"><Wallet size={24} strokeWidth={1.5}/></span>
      <span className="workspace-budget-info"><span className="workspace-budget-name"><strong>{budget.name}</strong>{index===0&&<span className="workspace-latest">Latest</span>}</span><span className="workspace-budget-updated">{updatedLabel(budget.updatedAt)}</span></span>
      <span className="workspace-budget-open">{openingBudget===budget.id?<LoadingIndicator label="Opening budget"/>:<><span className="workspace-open-label">Open budget</span><ArrowRight size={20}/></>}</span>
     </button>)}
     {empty&&<div className="workspace-first-budget"><div className="workspace-first-intro"><div><h3>Start with what you have.</h3><p>Enter today’s account balances. Then plan your spending and savings.</p></div>{!practice&&<img src="/brand/pip-welcome-small.png" alt="Pip, your budgeting companion" width="112" height="112"/>}</div><ol className="workspace-first-steps"><li><span>1</span>Add your accounts</li><li><span>2</span>Plan your money</li><li><span>3</span>Record spending</li></ol><div className="workspace-first-actions"><button className="button primary" disabled={!canCreate} onClick={onCreate}>Create budget<ArrowRight size={16}/></button><button className="text-button" ref={exampleButton} onClick={()=>setPractice(true)}>Try a quick example<ArrowUpRight size={15}/></button></div><p className="workspace-pip-note">Pip can explain things as you go.</p></div>}
    </div>
    {full&&<p className="workspace-limit">All {usage?.budgetLimit} spaces are in use. {billing?.discountsEnabled?'A coupon can add more.':'Open an existing budget to continue.'}</p>}
    {billing&&!billing.canEdit&&<p className="workspace-limit">Your saved budgets are available to view and export. <button onClick={onManagePlan}>Choose a plan</button> to create or edit.</p>}
    {!empty&&<p className="workspace-budget-footnote">Each budget has its own accounts and categories.</p>}
    {resume&&<div className="workspace-resume"><span>Pip saved your place.</span><button className="text-button" disabled={busy||onboarding.busy} onClick={()=>void onboarding.command({operation:'resume'}).then(ok=>{if(ok&&onboarding.state?.budgetId)onOpen(onboarding.state.budgetId);})}>Continue with Pip<ArrowRight size={14}/></button></div>}
    <OnboardingProblem controller={onboarding}/>
   </section>

   <aside className="workspace-sidebar">
    {billing?.state==='self-hosted'?<section className="workspace-plan" aria-label="Your SpentOn server"><div className="workspace-plan-heading"><h2>Your server</h2><span className="workspace-access-pill">Self-hosted</span></div><h3>Your budgets stay here.</h3><p className="workspace-plan-copy">Saved on {window.location.host}. No Cloud subscription is required.</p><button className="workspace-plan-button" onClick={event=>{event.currentTarget.focus();onManagePlan();}}>Server details<ArrowRight size={16}/></button></section>:billing&&<section className="workspace-plan" aria-label="Your SpentOn plan">
     <div className="workspace-plan-heading"><h2>Your plan</h2><span className={'workspace-access-pill '+(billing.canEdit?'':'expired')}>{trial?'Free trial':billing.state==='paid'?'Active':billing.state==='coupon'?'Coupon access':'View only'}</span></div>
     {trial?<><p className="workspace-trial-days"><strong>{billing.daysRemaining}</strong><span>{billing.daysRemaining===1?'day left':'days left'}</span></p><p className="workspace-plan-copy">All budgeting features are yours until <strong>{dateLabel(billing.trialEndsAt)}.</strong></p><span className="workspace-no-card"><Check size={14}/>No card needed. No automatic charge.</span></>:<><h3>{billing.canEdit?'You’re all set.':'Your plans are still here.'}</h3><p className="workspace-plan-copy">{billing.canEdit?'Your access continues through '+dateLabel(billing.accessEndsAt)+'.':'Open and export your saved budgets anytime. Choose a plan when you’re ready to keep going.'}</p></>}
     <button className="workspace-plan-button" onClick={event=>{event.currentTarget.focus();onManagePlan();}}>{billing.state==='paid'?'Manage plan':'View plans'}<ArrowRight size={16}/></button>
     {billing.state!=='paid'&&<p className="workspace-plan-price">US$7.99 monthly <span>·</span> US$79 for a year</p>}
    </section>}

    {billing?.discountsEnabled&&<details className="workspace-coupon"><summary><span className="workspace-gift"><Gift size={19}/></span><span>Have a coupon?<small>Redeem your benefits.</small></span><ChevronDown size={16}/></summary><div className="workspace-coupon-body"><p>Add its benefits to this account.</p><form onSubmit={onRedeem}><Field label="Coupon code"><input autoComplete="off" spellCheck={false} required maxLength={100} value={coupon} onChange={event=>onCouponChange(event.target.value)}/></Field><button className="button secondary full" disabled={busy}>Redeem coupon</button></form>{notice&&<p role="status" className="cloud-notice">{notice}</p>}{!!usage?.budgetCredits&&<p className="workspace-coupon-credit">{usage.budgetCredits} extra budget {usage.budgetCredits===1?'space':'spaces'} added.</p>}</div></details>}
    {user.isAdmin&&<a className="workspace-admin" href="/admin"><ShieldCheck size={15}/>Owner admin<ArrowUpRight size={14}/></a>}
   </aside>
  </div>
  <footer className="workspace-home-footer"><span><Cloud size={15}/>Your budgets, saved to your account.</span><button onClick={onGuide}>Help &amp; guidance<ArrowUpRight size={14}/></button></footer>
 </div>{practice&&<Modal title="A quick example with Pip" className="workspace-example" onClose={closePractice}><LearningWelcome controller={onboarding} onStart={()=>{setPractice(false);if(canCreate)onCreate();}} onDismiss={closePractice}/></Modal>}{methods&&<Modal title="Sign-in methods" onClose={()=>setMethods(false)}><div className="form-body"><p>Connect a provider that uses the same email as your SpentOn account.</p><SocialSignIn connect existingUser={user} onSignedIn={()=>{}}/></div></Modal>}</main>;
}
