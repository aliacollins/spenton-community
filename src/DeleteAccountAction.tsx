import LoadingState from './LoadingState';
import {useEffect,useState} from 'react';
import type {FormEvent} from 'react';
import {api,CloudError} from './cloud';
import type {CloudUser} from './cloud';
import {Field} from './ui';
import {download} from './storage';
import {forgetLastSignIn} from './last-signin';
import {AuthForm} from './AuthForm';

export default function DeleteAccountAction({token}:{token:string}){
 const [user,setUser]=useState<CloudUser|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [confirmation,setConfirmation]=useState(''),[wrongAccount,setWrongAccount]=useState(false);
 async function checkSession(){setLoading(true);try{setUser((await api<{user:CloudUser}>('/auth/me')).user);setError('');}catch(cause){if(cause instanceof CloudError&&cause.status===401)setUser(null);else setError(cause instanceof Error?cause.message:'Could not check your session.');}finally{setLoading(false);}}
 useEffect(()=>{if(token)void checkSession();else setLoading(false);},[token]);
 async function submit(event:FormEvent){event.preventDefault();if(busy)return;setBusy(true);setError('');try{await api('/account/delete',{method:'POST',body:{token,confirmation}});forgetLastSignIn();setDone(true);}catch(cause){if(cause instanceof CloudError&&cause.status===401){setUser(null);setNotice('Sign in again below. Your deletion link is still here, and nothing has been deleted.');}else {setError(cause instanceof Error?cause.message:'Deletion could not be confirmed. Try again.');if(cause instanceof CloudError&&cause.code==='WRONG_ACCOUNT')setWrongAccount(true);}}finally{setBusy(false);}}
 async function exportData(){if(busy)return;setBusy(true);setError('');try{const data=await api('/account/export',{method:'POST',body:{operationId:crypto.randomUUID()}});download(JSON.stringify(data,null,2),'spenton-account-data-'+new Date().toISOString().slice(0,10)+'.json');setNotice('Your data has been downloaded. Import its budgets from Create a budget if you return.');}catch(cause){setError(cause instanceof Error?cause.message:'Could not download your data.');}finally{setBusy(false);}}
 return <main className="account-action deletion-action"><a className="cloud-brand" href="/app"><img src="/brand/spenton-symbol.svg" alt=""/><span>SpentOn</span></a><img className="deletion-pip" src="/brand/pip-email-delete-sad.png" alt="Pip with a sad farewell expression" width="120" height="120"/>
  <h1>{done?'Your account has been deleted.':'Delete your account?'}</h1>
  {done?<><p role="status">Your budgets and sign-in records have been removed from the active service. Pip will miss you.</p><p>If you return, create an account and import your downloaded budgets.</p><a className="button primary" href="/app">Return to SpentOn</a></>:!token?<p role="alert">This deletion link is missing or incomplete. Open Account & privacy to request a new link.</p>:loading?<LoadingState label="Checking your sign-in"/>:<>
   {notice&&<p role="status" className="cloud-notice">{notice}</p>}
   {error&&<p role="alert" className="form-error">{error}</p>}
   {!user?<><p>Sign in to the account that requested deletion. Your confirmation link stays on this page.</p><AuthForm signInOnly onSignedIn={next=>{setUser(next);setError('');setNotice('You are signed in. Review the details below before confirming deletion.');}}/></>:<>
    <p>Signed in as <strong>{user.email}</strong>.</p><p>This permanently deletes all your budgets and sign-in records, and signs out every device.</p><p>Download your data so you can import your budgets if you decide to come back. Sign-in settings and subscriptions are not restored.</p>
    <button className="button secondary" disabled={busy} onClick={()=>void exportData()}>Download my data before deleting</button>
    {wrongAccount?<button className="button secondary" disabled={busy} onClick={async()=>{setBusy(true);try{await api('/auth/logout',{method:'POST'});setUser(null);setWrongAccount(false);setError('');}catch(cause){setError(cause instanceof Error?cause.message:'Could not sign out.');}finally{setBusy(false);}}}>Sign in to a different account</button>:<form onSubmit={submit}><Field label="Type DELETE to confirm"><input name="confirmation" required pattern="DELETE" maxLength={6} autoComplete="off" value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></Field><button className="button primary" disabled={busy||confirmation!=='DELETE'}>{busy?'One moment…':'Permanently delete my account'}</button></form>}
   </>}
   <a href="/app">Cancel and return to SpentOn</a>
  </>}
  <p><a href="/privacy">Privacy notice and backup retention</a></p>
 </main>;
}
