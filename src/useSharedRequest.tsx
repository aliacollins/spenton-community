import {useConfirmation} from './Confirmation';
import {useEffect,useRef,useState} from 'react';
import type {RefObject} from 'react';
import {api,CloudError,getBudget,validateSnapshot} from './cloud';
import type {CloudBudget} from './cloud';
import {pendingSharingRequest,writeSharingDraft,removeSharingDraft,clearFormForRequest} from './sharing-drafts';

type Request={path:string;body:Record<string,unknown>};
export function useSharedRequest(snapshot:CloudBudget,onSaved:(value:CloudBudget)=>void,blocked:RefObject<boolean>,scope:string,controller='groups'){
 const confirm=useConfirmation();
 const [restored]=useState(()=>pendingSharingRequest(scope,controller));
 const [busy,setBusy]=useState(false),[error,setError]=useState(restored?'An unconfirmed shared request was restored in this tab.':''),[code,setCode]=useState(''),[pending,setPending]=useState<Request|null>(restored),[recovered,setRecovered]=useState<Record<string,any>|null>(null),[storageWarning,setStorageWarning]=useState(false);
 const current=useRef<Request|null>(restored),sending=useRef(false),success=useRef<((value:any)=>void)|null>(null);
 useEffect(()=>{if(restored)blocked.current=true;},[]);
 useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(current.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[]);
 async function transmit(request:Request){
  if(sending.current)return;sending.current=true;blocked.current=true;setBusy(true);setError('');setCode('');
  try{
   const result=await api<{snapshot?:CloudBudget}&Record<string,any>>(request.path,{method:'POST',body:request.body});
   const valid=request.path.startsWith('/group-bill-series')?typeof result.series?.id==='string':request.path.startsWith('/group-bills')?typeof result.bill?.id==='string':request.path==='/shared-expenses'?typeof result.expense?.id==='string':request.path.startsWith('/shared-changes')?typeof result.change?.id==='string':request.path.endsWith('/invite')?typeof result.invitation?.url==='string':typeof result.group?.id==='string';
   if(!valid)throw new Error('The shared response could not be verified. Your original request is kept.');
   if(result.snapshot){const next=validateSnapshot(result.snapshot);if(next.id!==snapshot.id)throw new Error('Open the budget associated with this change. Your request is kept.');onSaved(next);}
   current.current=null;setPending(null);blocked.current=false;removeSharingDraft(scope,'pending-'+controller);clearFormForRequest(scope,request);if(success.current){const callback=success.current;success.current=null;callback(result);}else setRecovered(result);
  }catch(error){setError(error instanceof Error?error.message:'The change could not be confirmed.');setCode(error instanceof CloudError?error.code:'');}
  finally{sending.current=false;setBusy(false);}
 }
 function perform<T>(path:string,body:Record<string,unknown>,onSuccess:(value:T)=>void){
  if(current.current||sending.current)return;
  const request={path,body:{...body,ledgerVersion:3,groupVersion:1,operationId:crypto.randomUUID()}};
  success.current=onSuccess;current.current=request;setPending(request);setStorageWarning(!writeSharingDraft(scope,'pending-'+controller,snapshot.revision,{request:JSON.stringify(request)}));void transmit(request);
 }
 function exportRequest(){if(!pending)return;const url=URL.createObjectURL(new Blob([JSON.stringify(pending,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='SpentOn-shared-change-draft.json';a.click();URL.revokeObjectURL(url);}
 async function discard(){
  const original=current.current;if(!original||sending.current)return;
  if(!await confirm({title:'Discard this local request?',description:'A lost reply can mean the server saved it. The saved budget will be reloaded.',confirmLabel:'Discard request',cancelLabel:'Keep request',destructive:true})||current.current!==original||sending.current)return;
  try{const latest=await getBudget(snapshot.id);onSaved(latest);if(current.current)clearFormForRequest(scope,current.current);current.current=null;setPending(null);blocked.current=false;setError('');setCode('');success.current=null;setRecovered(null);removeSharingDraft(scope,'pending-'+controller);}
  catch(error){setError(error instanceof Error?error.message:'The saved budget could not be loaded. Your request is kept.');}
 }
 const recovery=<>{storageWarning&&<p className="group-recovery">The request is kept while this page is open. Export it before leaving if the save cannot be confirmed.</p>}{error&&<p className="form-error" role="alert">{error}</p>}{pending&&<section className="group-recovery" aria-label="Unconfirmed shared request"><p>{busy?'Saving your request…':'Your request has been kept. Retry it or export a copy before discarding.'}</p><div className="button-row"><button type="button" className="button secondary" disabled={busy||['REVISION_CONFLICT','CHANGE_STALE','GROUP_CHANGED','GROUP_BILL_CHANGED','GROUP_SERIES_CHANGED','GROUP_SERIES_OCCURRENCE','SHARE_OPERATION_REUSED','SHARED_HISTORY_CHANGED'].includes(code)} onClick={()=>void transmit(pending)}>Retry original request</button><button type="button" className="button secondary" onClick={exportRequest}>Export request</button><button type="button" className="button ghost" disabled={busy} onClick={()=>void discard()}>Discard request</button></div></section>}</>;
 return {scope,busy,pending,error,setError,perform,recovery,recovered,canClose:()=>!current.current&&!sending.current};
}
