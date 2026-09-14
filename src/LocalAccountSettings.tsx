import {useState} from 'react';
import type {FormEvent} from 'react';
import {api} from './cloud';
import {download} from './storage';
import {Field,Modal} from './ui';
import OnboardingPreferences from './OnboardingPreferences';

export default function LocalAccountSettings({username,userId,onClose}:{username:string;userId:string;onClose:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function exportData(){setBusy(true);setError('');try{const value=await api('/account/export',{method:'POST',body:{operationId:crypto.randomUUID()}});download(JSON.stringify(value,null,2),'spenton-account-data.json');setNotice('Your account data has been downloaded.');}catch(e){setError(e instanceof Error?e.message:'Could not download your data.');}finally{setBusy(false);}}
 async function submit(event:FormEvent<HTMLFormElement>,deleting=false){event.preventDefault();if(busy)return;setBusy(true);setError('');const form=new FormData(event.currentTarget);try{
  if(!deleting&&form.get('password')!==form.get('repeat'))throw new Error('The new passwords do not match.');
  await api(deleting?'/account/delete-local':'/account/password',{method:'POST',body:deleting?{password:form.get('currentPassword'),confirmation:form.get('confirmation')}:{currentPassword:form.get('currentPassword'),password:form.get('password')}});
  location.assign('/app');
 }catch(e){setError(e instanceof Error?e.message:'The change could not be completed.');}finally{setBusy(false);}}
 return <Modal title="Account & privacy" eyebrow="YOUR LOCAL ACCOUNT" onClose={busy?()=>{}:onClose}><div className="form-body account-privacy">
 <section><h3>{username}</h3><p>Your account is stored on this SpentOn installation. No email service or Cloud subscription is used.</p></section>
 <details><summary>Change password</summary><form onSubmit={event=>void submit(event)}><Field label="Current password"><input name="currentPassword" type="password" autoComplete="current-password" required/></Field><Field label="New password"><input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={1024} required/></Field><Field label="Confirm new password"><input name="repeat" type="password" autoComplete="new-password" minLength={12} maxLength={1024} required/></Field><p>Changing your password signs out all devices.</p><button className="button primary" disabled={busy}>Change password</button></form></details>
 <OnboardingPreferences userId={userId}/>
 <section><h3>Download your data</h3><p>Keep a private copy of your budgets and account records.</p><button className="button secondary" disabled={busy} onClick={()=>void exportData()}>Download all my data</button></section>
 <section><h3>Forgotten password</h3><p>The server operator can reset a password from Docker without email:</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}><code>docker compose -f self-hosted/compose.yaml exec app node self-hosted/reset-password.mjs</code></pre></section>
 <details className="settings-delete"><summary>Delete account</summary><form onSubmit={event=>void submit(event,true)}><p>This permanently deletes your private budgets and signs out every session. Shared records needed by other people can remain. Download your data first.</p><Field label="Current password"><input name="currentPassword" type="password" autoComplete="current-password" required/></Field><Field label="Type DELETE to confirm"><input name="confirmation" autoComplete="off" pattern="DELETE" required/></Field><button className="button danger" disabled={busy}>Delete my account</button></form></details>
 {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="form-error">{error}</p>}
 </div><div className="modal-footer"><a href="https://github.com/aliacollins/spenton-community" target="_blank" rel="noopener noreferrer">Source code · AGPLv3</a><button className="button primary" disabled={busy} onClick={onClose}>Done</button></div></Modal>;
}
