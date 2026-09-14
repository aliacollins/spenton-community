import LocalAccountSettings from './LocalAccountSettings';
import LoadingState from './LoadingState';
import OnboardingPreferences from './OnboardingPreferences';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, CloudError } from './cloud';
import type { CloudUser } from './cloud';
import { download } from './storage';
import { Field, Modal } from './ui';
import EmailPreferences from './EmailPreferences';
import SocialSignIn from './SocialSignIn';
import './privacy.css';
import EmailNotice from './EmailNotice';
import DeleteAccountAction from './DeleteAccountAction';
import BudgetResetPage, {BudgetResetNotice} from './BudgetReset';
import './verification.css';
import { Check, Sparkle, ShieldCheck, Download, ArrowUpRight, ChevronDown, Trash2 } from 'lucide-react';
const problem=(e:unknown)=>e instanceof Error?e.message:'This request could not be completed.';
type AccountStatus={localAccounts?:boolean;username?:string;email:string;emailVerified:boolean;emailAvailable:boolean;hasPassword:boolean;budgetCount:number};
export function AccountPrivacy({user,onClose}:{user:CloudUser;onClose:()=>void}){
 const [status,setStatus]=useState<AccountStatus|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[emailNotice,setEmailNotice]=useState('');
 useEffect(()=>{void api<AccountStatus>('/account').then(setStatus).catch(e=>setError(problem(e)));},[]);
 async function action(path:string,body:unknown={}){if(busy)return;setBusy(true);setError('');setNotice('');setEmailNotice('');try{const result=await api<{message:string}>(path,{method:'POST',body});setEmailNotice(result.message);}catch(e){setError(problem(e));}finally{setBusy(false);}}
 async function exportAll(){setBusy(true);setError('');try{const data=await api('/account/export',{method:'POST',body:{operationId:crypto.randomUUID()}});download(JSON.stringify(data,null,2),'spenton-account-data-'+new Date().toISOString().slice(0,10)+'.json');setNotice('Your account data has been downloaded. Keep this file somewhere private.');}catch(e){setError(problem(e));}finally{setBusy(false);}}
 if(status?.localAccounts)return <LocalAccountSettings userId={user.id} username={status.username??''} onClose={onClose}/>;
 return <Modal title="Account & privacy" eyebrow="YOUR PERSONAL SPACE" className="modal-standard account-settings" onClose={onClose}><div className="form-body account-privacy">{!status&&!error&&<LoadingState label="Opening account settings"/>}{status&&<>
 <section className="settings-profile"><div className="settings-avatar" aria-hidden="true">{status.email.charAt(0).toUpperCase()}</div><div className="settings-identity"><h3>{status.email}</h3><span className={'settings-badge '+(status.emailVerified?'verified':'')}>{status.emailVerified?'Email verified':'Email unverified'}</span></div><ShieldCheck size={24} className="settings-profile-icon" aria-hidden="true"/><div className="settings-security"><div className="button-row">{!status.emailVerified&&<button className="button secondary" disabled={busy||!status.emailAvailable} onClick={()=>void action('/auth/send-verification',{email:user.email})}>Verify email</button>}<button className="button secondary" disabled={busy||!status.emailAvailable} onClick={()=>void action('/auth/request-reset',{email:user.email})}>{status.hasPassword?'Reset password':'Set a password'}</button></div>{!status.emailAvailable&&<span className="settings-caption">Email actions available soon</span>}</div><details className="settings-connections"><summary>Connected sign-in methods <ChevronDown size={15}/></summary><SocialSignIn connect existingUser={user} onSignedIn={()=>{}}/></details></section>
 <EmailPreferences/>
 <BudgetResetNotice/>
 <OnboardingPreferences userId={user.id}/>
 <div className="settings-card-grid"><section className="settings-card"><span className="settings-icon"><Download size={19}/></span><h3>Download your data</h3><p>Download your profile, {status.budgetCount===1?'your budget':status.budgetCount+' budgets'} and account history. Import your budgets if you decide to come back.</p><button className="settings-link" disabled={busy} onClick={()=>void exportAll()}>Download all my data <Download size={15}/></button></section><section className="settings-card"><span className="settings-icon"><ShieldCheck size={19}/></span><h3>Privacy comes first</h3><p>Read how SpentOn uses your data. For privacy questions, <a href="mailto:privacy@spenton.dev">contact us.</a></p><a className="settings-link" href="/privacy" target="_blank" rel="noopener noreferrer">Read privacy notice <ArrowUpRight size={16}/></a></section></div>
 <details className="settings-delete"><summary><Trash2 size={17}/><span>Delete account</span><ChevronDown size={16}/></summary><div><p>Deletes every budget and sign-in record, and signs out all devices. Download your data so you can import your budgets if you decide to come back. Cancel any recurring subscription before deletion; limited payment and security records may be retained where necessary.</p><p>We’ll email a confirmation link. Requesting or opening it does not delete anything.</p><button className="button secondary" disabled={busy||!status.emailAvailable} onClick={()=>void action('/account/delete-request')}>Request account deletion</button><p className="small muted">{!status.emailAvailable?'Email confirmation is not available yet. ':''}You can request deletion at <a href="mailto:privacy@spenton.dev">privacy@spenton.dev</a>.</p></div></details>
 </>}{emailNotice&&<EmailNotice email={status?.email??user.email} message={emailNotice}/>} {notice&&<p role="status" className="cloud-notice">{notice}</p>}{error&&<p role="alert" className="form-error">{error}</p>}</div><div className="modal-footer"><span className="settings-footer-note"><ShieldCheck size={14}/> Your space stays yours.</span><button className="button primary" onClick={onClose}>Done</button></div></Modal>;
}
export function AccountAction(){
 const [kind]=useState(()=>new URLSearchParams(location.search).get('account-action'));
 const [token]=useState(()=>new URLSearchParams(location.hash.slice(1)).get('token')??'');
 const [busy,setBusy]=useState(false),[done,setDone]=useState(false),[error,setError]=useState(''),[needsLogin,setNeedsLogin]=useState(false);
 useEffect(()=>{history.replaceState(null,'',location.pathname+location.search);},[]);
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');const fields=new FormData(event.currentTarget);try{
  if(kind==='reset'&&fields.get('password')!==fields.get('repeat'))throw new Error('The passwords do not match.');
  await api(kind==='reset'?'/auth/confirm-reset':kind==='verify'?'/auth/confirm-email':kind==='unsubscribe'?'/email/unsubscribe':'/account/delete',{method:'POST',body:{token,password:fields.get('password'),confirmation:fields.get('confirmation')}});setDone(true);
 }catch(e){if(e instanceof CloudError&&e.status===401)setNeedsLogin(true);setError(problem(e));}finally{setBusy(false);}}
 if(kind==='delete')return <DeleteAccountAction token={token}/>;
 if(kind==='budget-reset')return <BudgetResetPage/>;
 const valid=['reset','verify','unsubscribe'].includes(kind??'')&&!!token;
 if(kind==='verify')return <main className="verification-page">
  <a className="cloud-brand verification-brand" href="/app"><img src="/brand/spenton-symbol.svg" alt=""/><span>SpentOn</span></a>
  <section className="verification-card" aria-labelledby="verification-title">
   <div className="verification-art" aria-hidden="true"><span className="verification-orbit"/><img src="/brand/pip-welcome-small.png" alt="" width="184" height="184"/><span className="verification-spark spark-one"><Sparkle size="1em" fill="currentColor" strokeWidth={0}/></span><span className="verification-spark spark-two"><Sparkle size="1em" fill="currentColor" strokeWidth={0}/></span></div>
   <div className="verification-content">
    <span className="verification-badge"><ShieldCheck size={15}/>{done?'EMAIL VERIFIED':'YOUR PERSONAL SPACE'}</span>
    <h1 id="verification-title">{done?'Your email is verified.':valid?'Verify your email.':'Request a new link.'}</h1>
    <p className="verification-description">{done?'Sign in to open your budgets.':valid?'Confirm that this email address belongs to you.':'This verification link is missing or incomplete. Return to sign in to request a fresh one.'}</p>
    {done?<div role="status" className="verification-complete"><span className="verification-check" aria-hidden="true"><Check size={13} strokeWidth={2.5}/></span>Email address confirmed</div>:null}
    {done||!valid?<a className="button primary verification-cta" href="/app">{done?'Continue to sign in':'Return to sign in'}<ArrowUpRight size={18}/></a>:<form onSubmit={submit}>{error&&<p role="alert" className="form-error">{error}</p>}<button className="button primary verification-cta" disabled={busy}>{busy?'Verifying your email…':'Verify my email'}<ArrowUpRight size={18}/></button><p className="verification-note">This confirms your email. You’ll sign in next.</p></form>}
    {done&&<p className="verification-note">A fresh start for your money. One small step at a time.</p>}
   </div>
   <div className="verification-footer"><ShieldCheck size={15}/><span>Your budgets are private.</span><a href="/privacy">Privacy notice</a></div>
  </section>
 </main>;
 return <main className="account-action"><a className="cloud-brand" href="/app"><img src="/brand/spenton-symbol.svg" alt=""/><span>SpentOn</span></a><h1>{done?(kind==='unsubscribe'?'Reminder emails are off.':kind==='reset'?'Your password has been changed.':'Your email is verified.'):(kind==='unsubscribe'?'Turn off reminder emails?':kind==='reset'?'Choose a new password.':'Confirm your email.')}</h1>{done?<><p>{kind==='unsubscribe'?'You can choose a new reminder schedule in Account & privacy at any time.':kind==='reset'?'All previous sessions have been signed out. Sign in with your new password.':'You can now sign in to your SpentOn account.'}</p><a className="button primary" href="/app">Continue to sign in</a></>:!valid?<p role="alert">This link is missing or invalid. Request a new link from SpentOn.</p>:<form onSubmit={submit}>{kind==='reset'?<><Field label="New password"><input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={1024}/></Field><Field label="Confirm new password"><input name="repeat" type="password" autoComplete="new-password" required minLength={12} maxLength={1024}/></Field><p>Use at least 12 characters. Changing your password signs out all devices.</p></>:kind==='unsubscribe'?<p>Turn off budget reminders. You will still receive account security emails.</p>:<p>Confirm that the email address receiving this link belongs to you. This does not sign you in automatically.</p>}{error&&<p role="alert" className="form-error">{error}</p>}{needsLogin&&<p><a href="/app" target="_blank" rel="noopener noreferrer">Sign in in another tab</a>, then retry this confirmation here.</p>}<button className="button primary" disabled={busy}>{busy?'One moment…':kind==='unsubscribe'?'Unsubscribe from reminders':kind==='reset'?'Save new password':'Verify my email'}</button><a href="/app">Cancel and return to SpentOn</a></form>}<p><a href="/privacy">Privacy notice</a></p></main>;
}
