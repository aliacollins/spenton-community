import LoadingState from './LoadingState';
import {useEffect, useState} from 'react';
import {ArrowUpRight, Download, RotateCcw, ShieldCheck} from 'lucide-react';
import {api, CloudError} from './cloud';
import type {CloudUser} from './cloud';
import {AuthForm} from './AuthForm';
import {Field} from './ui';
import {download} from './storage';
import './budget-reset.css';

type ResetRequest = {id:string;state:'pending'|'cancelled'|'completed';budgetCount:number;reason:string;expiresAt:string;completedAt:string|null;problem?:string};
type Review = {request:ResetRequest|null;budgets?:string[]};
const problem = (error:unknown) => error instanceof Error ? error.message : 'This request could not be completed.';
const resetUrl = '/app?account-action=budget-reset';
const expires = (value:string) => new Date(value).toLocaleString();

export function BudgetResetNotice() {
  const [request,setRequest]=useState<ResetRequest|null>(null);
  useEffect(()=>{let active=true;void api<Review>('/account/budget-reset').then(value=>{if(active)setRequest(value.request);}).catch(()=>{});return()=>{active=false;};},[]);
  if(request?.state!=='pending')return null;
  return <section className="budget-reset-notice"><div className="budget-reset-heading"><ShieldCheck size={20}/><h3>Review a budget reset request</h3></div><p>Support requested permission to clear your budgets and restart setup. Review it or decline. Nothing changes until you confirm.</p><a className="button secondary" href={resetUrl} target="_blank" rel="noopener noreferrer">Review budget reset <ArrowUpRight size={16}/></a><p className="small muted">Opens in a new tab so your current draft stays available.</p></section>;
}

export default function BudgetResetPage() {
  const [user,setUser]=useState<CloudUser|null>(null),[review,setReview]=useState<Review|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[confirmation,setConfirmation]=useState(''),[reviewed,setReviewed]=useState(false),[uncertain,setUncertain]=useState(false);
  async function refresh() {
    setLoading(true);setError('');setReview(null);
    try {
      const account=await api<{user:CloudUser}>('/auth/me');setUser(account.user);
      const result=await api<Review>('/account/budget-reset');setReview(result);setUncertain(false);
      setConfirmation('');setReviewed(false);
    } catch(error) {if(error instanceof CloudError&&error.status===401)setUser(null);else setError(problem(error));}
    finally {setLoading(false);}
  }
  useEffect(()=>{void refresh();},[]);
  async function confirm(event:React.FormEvent) {
    event.preventDefault();if(busy||!review?.request)return;setBusy(true);setError('');
    try {
      await api('/account/budget-reset/confirm',{method:'POST',body:{requestId:review.request.id,confirmation,reviewed}});
      setDone(true);
    } catch(error) {
      setError(problem(error));setUncertain(true);
      if(error instanceof CloudError&&error.status===401)setUser(null);
      setNotice('Check reset status before trying again. If your session ended, sign in to see whether the reset completed.');
    } finally {setBusy(false);}
  }
  async function exportData() {
    setBusy(true);setError('');
    try {const data=await api('/account/export',{method:'POST',body:{operationId:crypto.randomUUID()}});download(JSON.stringify(data,null,2),'spenton-before-reset-'+new Date().toISOString().slice(0,10)+'.json');setNotice('Your account data has been downloaded. Keep the file somewhere private.');}
    catch(error) {setError(problem(error));} finally {setBusy(false);}
  }
  async function decline() {
    if(!review?.request||busy)return;setBusy(true);setError('');
    try {await api('/account/budget-reset/cancel',{method:'POST',body:{requestId:review.request.id}});setReview({request:null});setNotice('Reset declined. Your budgets have not been changed.');}
    catch(error) {setError(problem(error));} finally {setBusy(false);}
  }
  const reset=review?.request, completed=done||reset?.state==='completed';
  return <main className="budget-reset-page">
    <a className="cloud-brand" href="/app"><img src="/brand/spenton-symbol.svg" alt=""/><span>SpentOn</span></a>
    <section className="budget-reset-card" aria-labelledby="reset-title">
      <header className="budget-reset-header">
        <span className="budget-reset-icon"><RotateCcw size={24}/></span>
        <div><span className="cloud-eyebrow">YOUR ACCOUNT, YOUR DECISION</span>
          <h1 id="reset-title">{completed?'Your budget reset is complete.':'Review your budget reset.'}</h1>
          {user&&!completed&&<p className="budget-reset-identity">Signed in as <strong>{user.email}</strong></p>}
        </div>
      </header>
      <div className="budget-reset-body">
        {loading?<LoadingState label="Checking your reset request" detail="Loading the request for your signed-in account."/>:completed?<>
          <p role="status">Your previous budgets were cleared and setup was restarted. All sessions ended. Your login, access dates and billing records were preserved.</p>
          <a className="button primary" href="/app">Continue to SpentOn <ArrowUpRight size={17}/></a>
        </>:!user?<>
          <p>Sign in to review your own reset request. Signing in does not clear any data.</p>
          <AuthForm signInOnly onSignedIn={()=>void refresh()}/>
        </>:reset?.state==='pending'?<>
          <section className="budget-reset-request" aria-label="Support request">
            <div><span className="budget-reset-label">REASON FROM SUPPORT</span><p>{reset.reason}</p></div>
            <p className="budget-reset-expiry">Expires {expires(reset.expiresAt)}</p>
          </section>
          <div className="budget-reset-scope-grid">
            <section className="budget-reset-scope">
              <span className="budget-reset-label">WHAT WILL BE CLEARED</span>
              <h2>{reset.budgetCount} {reset.budgetCount===1?'budget':'budgets'} to clear</h2>
              <p>Accounts, categories, transactions, goals and scheduled entries in these budgets. Setup progress and feedback will restart.</p>
              {!!review?.budgets?.length&&<ul>{review.budgets.map((name,index)=><li key={index}>{name}</li>)}</ul>}
            </section>
            <section className="budget-reset-kept">
              <span className="budget-reset-label">WHAT WILL BE KEPT</span>
              <h2>Your account and access</h2>
              <p>Sign-in methods, access dates, payments, subscriptions and privacy choices stay in place.</p>
              <p>This does not restart your trial. Every device will be signed out.</p>
            </section>
          </div>
          <section className="budget-reset-download">
            <div><h2>Keep a copy before you reset</h2><p>This reset has no undo button. Download your data if you may need these budgets again.</p></div>
            <button className="button secondary" disabled={busy} onClick={()=>void exportData()}><Download size={17}/>Download my data before resetting</button>
            <p className="budget-reset-backups">Private backups follow the retention in our <a href="/privacy">privacy notice</a>.</p>
          </section>
          {reset.problem?<><p role="alert" className="form-error">{reset.problem}</p><button className="button secondary" disabled={busy} onClick={()=>void decline()}>Decline this reset</button></>:<form className="budget-reset-confirm" onSubmit={event=>void confirm(event)}>
            <label className="check-label"><input type="checkbox" checked={reviewed} onChange={event=>setReviewed(event.target.checked)} required disabled={busy||uncertain}/><span>I reviewed what will be cleared and want to restart setup.</span></label>
            <Field label="Type RESET to confirm"><input value={confirmation} onChange={event=>setConfirmation(event.target.value)} autoComplete="off" required pattern="RESET" maxLength={5} disabled={busy||uncertain}/></Field>
            <div className="budget-reset-decision">
              <button type="button" className="button secondary" disabled={busy} onClick={()=>void decline()}>Decline this reset</button>
              <button className="button primary" disabled={busy||uncertain||!reviewed||confirmation!=='RESET'}>{busy?'Please wait…':'Clear my budgets and restart setup'}</button>
            </div>
          </form>}
        </>:<p>{reset?.state==='cancelled'?'This reset request was declined or replaced.':'There is no reset request for this account.'}</p>}
      </div>
      {!completed&&<footer className="budget-reset-footer">
        {notice&&<p role="status" className="cloud-notice">{notice}</p>}
        {error&&<p role="alert" className="form-error">{error}</p>}
        <div><a href="/app">Return to your budgets</a><button className="text-button" disabled={busy||loading} onClick={()=>void refresh()}>Check reset status</button></div>
      </footer>}
    </section>
  </main>;
}
