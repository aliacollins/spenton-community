import LoadingState from './LoadingState';
import {useConfirmation} from './Confirmation';
import {useEffect,useRef,useState} from 'react';
import {api,CloudError,getBudget} from './cloud';
import type {BudgetSummary,CloudBudget} from './cloud';
import {AuthForm} from './AuthForm';
import {Field} from './ui';
import Select from './Select';
import './expense-groups.css';
import {pendingSharingRequest,writeSharingDraft,removeSharingDraft,sharingScope} from './sharing-drafts';

export default function GroupInvitation(){
 const confirm=useConfirmation();
 const [token]=useState(()=>new URLSearchParams(location.hash.slice(1)).get('token')??'');
 const [preview,setPreview]=useState<{name:string;currency:string;memberCount:number;disclosure:string}|null>(null),[budgets,setBudgets]=useState<BudgetSummary[]>([]),[snapshot,setSnapshot]=useState<CloudBudget|null>(null),[selected,setSelected]=useState(''),[login,setLogin]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false),[confirmed,setConfirmed]=useState(false),[scope,setScope]=useState(''),[unconfirmed,setUnconfirmed]=useState(false),[storageWarning,setStorageWarning]=useState(false),[conflict,setConflict]=useState(false);
 const pending=useRef<Record<string,unknown>|null>(null);
 async function load(){
  setBusy(true);setError('');
  try{
   const {user}=await api<{user:{id:string}}>('/auth/me'),ownerScope=sharingScope(user.id,'group-invitation');setScope(ownerScope);setLogin(false);
   const restored=pendingSharingRequest(ownerScope,'invitation');
   if(restored){pending.current=restored.body;setUnconfirmed(true);setSelected(String(restored.body.budgetId));setSnapshot(await getBudget(String(restored.body.budgetId)));return;}
   setPreview(await api<typeof preview>('/group-invitations/preview',{method:'POST',body:{token}}));setBudgets((await api<{budgets:BudgetSummary[]}>('/budgets')).budgets);
  }catch(error){if(error instanceof CloudError&&error.status===401)setLogin(true);else setError(error instanceof Error?error.message:'The invitation could not be opened.');}
  finally{setBusy(false);}
 }
 useEffect(()=>{history.replaceState(null,'','/?group-invite');void load();},[]);
 useEffect(()=>{if(!selected){setSnapshot(null);return;}let active=true;setSnapshot(null);void getBudget(selected).then(value=>{if(active)setSnapshot(value);}).catch(e=>setError(e.message));return()=>{active=false;};},[selected]);
 useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(pending.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[]);
 async function join(){
  if(busy||!scope||(!snapshot&&!pending.current))return;setBusy(true);setError('');setConflict(false);
  if(!pending.current){pending.current={token,budgetId:snapshot!.id,expectedRevision:snapshot!.revision,confirmJoin:confirmed,operationId:crypto.randomUUID(),groupVersion:1};setStorageWarning(!writeSharingDraft(scope,'pending-invitation',snapshot!.revision,{request:JSON.stringify({path:'/group-invitations/join',body:pending.current})}));}
  setUnconfirmed(true);
  try{const result=await api<{group:{id:string}}>('/group-invitations/join',{method:'POST',body:pending.current});if(typeof result.group?.id!=='string')throw new Error('The join could not be verified. Retry the original request.');setDone(true);pending.current=null;setUnconfirmed(false);removeSharingDraft(scope,'pending-invitation');}
  catch(error){setError(error instanceof Error?error.message:'The join could not be confirmed. Retry the original request.');setConflict(error instanceof CloudError&&['REVISION_CONFLICT','SHARE_OPERATION_REUSED','SHARED_HISTORY_CHANGED'].includes(error.code));}
  finally{setBusy(false);}
 }
 function exportRequest(){if(!pending.current)return;const url=URL.createObjectURL(new Blob([JSON.stringify({path:'/group-invitations/join',body:pending.current},null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='SpentOn-group-join-draft.json';link.click();URL.revokeObjectURL(url);}
 async function discard(){
  const original=pending.current;if(!original||busy)return;
  if(!await confirm({title:'Discard this local request?',description:'The group may already be joined. Your saved groups will be checked first.',confirmLabel:'Discard request',cancelLabel:'Keep request',destructive:true})||pending.current!==original)return;
  setBusy(true);try{await api('/expense-groups');removeSharingDraft(scope,'pending-invitation');pending.current=null;location.assign('/app?groups');}catch(error){setError(error instanceof Error?error.message:'Your groups could not be checked. The request is kept.');}finally{setBusy(false);}
 }
 return <main className="account-action group-invitation-page"><a className="cloud-brand" href="/app" onClick={event=>{if(unconfirmed)event.preventDefault();}}><img src="/brand/spenton-symbol.svg" alt=""/><span>SpentOn</span></a><h1>{done?'You joined the group':login?'You have a group invitation':unconfirmed?'Joining not confirmed':preview?.name??'Review your invitation'}</h1>
  {done?<><p>Open Groups in SpentOn to review the bills. Joining has not accepted a share or recorded a payment.</p><a className="button primary" href="/app?groups">Open Groups</a></>:login?<><p>Sign in or create an account to review this private group.</p><AuthForm onSignedIn={()=>void load()}/></>:unconfirmed?<section className="group-recovery" aria-label="Unconfirmed group join"><p>Your original request is kept. Retry to confirm whether you joined.</p>{storageWarning&&<p>Export a copy before leaving; this browser could not keep it.</p>}<button className="button primary" disabled={busy||conflict} onClick={()=>void join()}>Retry joining</button><button className="button secondary" onClick={exportRequest}>Export request</button><button className="button ghost" disabled={busy} onClick={()=>void discard()}>Discard request</button></section>:preview?<div className="group-form"><p>{preview.memberCount} people · {preview.currency}</p><p>{preview.disclosure}</p>{budgets.length?<><Field label="Your budget for this group"><Select required value={selected} disabled={busy||!!pending.current} onChange={e=>setSelected(e.target.value)}><option value="">Choose your budget</option>{budgets.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>{snapshot&&snapshot.budget.currency!==preview.currency&&<p>Choose a budget in {preview.currency}.</p>}<label className="shared-check"><input type="checkbox" checked={confirmed} disabled={busy||!!pending.current} onChange={e=>setConfirmed(e.target.checked)}/>I want to join this group.</label><button className="button primary" disabled={busy||(!pending.current&&(!confirmed||snapshot?.budget.currency!==preview.currency))} onClick={()=>void join()}>{pending.current?'Retry joining':'Join group'}</button></>:<p>Create your first budget in SpentOn, then reopen this invitation to join the group.</p>}</div>:busy?<LoadingState label="Opening your group invitation"/>:null}
  {error&&<p className="form-error" role="alert">{error}</p>}{!preview&&!login&&!busy&&!unconfirmed&&<button className="button secondary" onClick={()=>void load()}>Try again</button>}
 </main>;
}
