import {useEffect,useRef,useState} from 'react';

const prefix='spenton.sharing-draft.v1:';
type RecordValue={revision:number;fields:Record<string,string>;savedAt:number};
const storageKey=(scope:string,key:string)=>prefix+scope+':'+key;
export function readSharingDraft(scope:string,key:string,permanent=false):RecordValue|null{
 try{
  const raw=sessionStorage.getItem(storageKey(scope,key));if(!raw||raw.length>100000)return null;
  const value=JSON.parse(raw);
  if(!value||!Number.isSafeInteger(value.revision)||!Number.isFinite(value.savedAt)||(!permanent&&Date.now()-value.savedAt>86400000)||!value.fields||typeof value.fields!=='object'||Object.values(value.fields).some(v=>typeof v!=='string'))return null;
  return value;
 }catch{return null;}
}
export function writeSharingDraft(scope:string,key:string,revision:number,fields:Record<string,string>){
 try{sessionStorage.setItem(storageKey(scope,key),JSON.stringify({revision,fields,savedAt:Date.now()}));return true;}catch{return false;}
}
export function removeSharingDraft(scope:string,key:string){try{sessionStorage.removeItem(storageKey(scope,key));}catch{/* In-memory recovery remains available. */}}
export function clearFormForRequest(scope:string,request:{path:string;body:Record<string,unknown>}){
 const b=request.body;
 if(request.path.startsWith('/group-bills/'))removeSharingDraft(scope,'group-bill-review-'+request.path.split('/')[2]);
 if((request.path==='/group-bills'||request.path==='/group-bill-series')&&typeof b.groupId==='string')removeSharingDraft(scope,'group-bill-'+b.groupId);
 if(request.path==='/group-bill-series'&&typeof b.groupId==='string')removeSharingDraft(scope,'group-recurring-'+b.groupId);
 if(request.path.startsWith('/group-bill-series/')&&b.actionType==='edit')removeSharingDraft(scope,'group-series-'+request.path.split('/').at(-1));
 if(request.path==='/expense-groups')removeSharingDraft(scope,'create-group');
 if(request.path==='/shared-expenses'&&typeof b.groupId==='string')removeSharingDraft(scope,'group-purchase-'+b.groupId);
 if(request.path.startsWith('/expense-groups/')&&b.actionType==='add-member')removeSharingDraft(scope,'group-member-'+request.path.split('/').at(-1));
 if(request.path==='/shared-changes'){
  const source=b.kind==='reverse_payment'?b.settlementId:b.kind==='offset'?String(b.groupId)+':'+String(b.otherMemberId):b.kind==='reverse_offset'?b.changeId:b.expenseId;
  removeSharingDraft(scope,'change-'+String(b.kind)+'-'+String(source));
 }
}
export function clearSharingDrafts(userId:string){try{for(const key of Object.keys(sessionStorage))if(key.startsWith(prefix+userId+':'))sessionStorage.removeItem(key);}catch{/* Storage may be disabled. */}}
export const sharingScope=(userId:string,budgetId:string)=>userId+':'+budgetId;
export function pendingSharingRequest(scope:string,controller:string){
 const raw=readSharingDraft(scope,'pending-'+controller,true)?.fields.request;
 try{
  const value=raw?JSON.parse(raw):null;
  if(!value||typeof value.path!=='string'||!/^\/(shared-expenses|expense-shares\/[0-9a-f-]{36}\/(?:respond|repay|invite|receive)|share-settlements\/[0-9a-f-]{36}(?:\/record)?|expense-groups(?:\/[0-9a-f-]{36})?|expense-group-members\/[0-9a-f-]{36}\/invite|group-invitations\/join|shared-changes(?:\/[0-9a-f-]{36})?|group-bills(?:\/[0-9a-f-]{36}\/(?:confirm|accept))?|group-bill-series(?:\/[0-9a-f-]{36})?)$/.test(value.path)||!value.body||typeof value.body!=='object'||!/^[0-9a-f-]{36}$/.test(value.body.operationId))return null;
  return value as {path:string;body:Record<string,unknown>};
 }catch{return null;}
}

/** Only editor fields are kept in this tab; saved budget documents never enter this cache. */
export function useSharingFormDraft(scope:string,key:string,revision:number,fields:Record<string,string>,restore:(fields:Record<string,string>)=>void,dirty=true){
 const loaded=useRef(false),skip=useRef(false),finished=useRef(false),baseline=useRef(revision),reviewedContext=useRef(fields.context);
 const [restored,setRestored]=useState(false),[needsReview,setNeedsReview]=useState(false),[unavailable,setUnavailable]=useState(false);
 const serialized=JSON.stringify(fields);
 useEffect(()=>{
  const saved=readSharingDraft(scope,key);loaded.current=true;
  if(saved){skip.current=true;restore(saved.fields);baseline.current=saved.revision;reviewedContext.current=saved.fields.context;setRestored(true);setNeedsReview(saved.revision!==revision||saved.fields.context!==fields.context);}
 },[scope,key]);
 useEffect(()=>{
  if(skip.current){skip.current=false;return;}
  if(loaded.current&&!finished.current&&dirty)setUnavailable(!writeSharingDraft(scope,key,baseline.current,{...fields,...(needsReview&&fields.context!==undefined?{context:reviewedContext.current??''}:{})}));
 },[serialized,dirty,scope,key,needsReview]);
 function clear(){finished.current=true;removeSharingDraft(scope,key);}
 const notice=unavailable?<p className="group-recovery" role="status">This browser could not keep a recovery copy. Keep this page open until you save or cancel.</p>:restored?<div className="group-recovery" role="status"><p>{needsReview?'Draft restored. Your budget or group changed; check the amounts and people before saving.':'Draft restored in this tab. Review it before saving.'}</p><button type="button" className="button secondary" onClick={()=>{baseline.current=revision;reviewedContext.current=fields.context;setNeedsReview(false);setRestored(false);writeSharingDraft(scope,key,revision,fields);}}>Reviewed</button></div>:null;
 return {notice,needsReview,clear};
}
