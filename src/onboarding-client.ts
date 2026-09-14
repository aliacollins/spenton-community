import {useCallback,useEffect,useRef,useState} from 'react';
import {api,CloudError} from './cloud';
export const learningSteps=['welcome','budget','plan','purchase','insights'] as const;
export type LearningStep=typeof learningSteps[number];
export type OnboardingState={version:number;revision:number;cohort:'new'|'existing';status:'offered'|'active'|'paused'|'dismissed'|'completed';experience:'beginner'|'familiar';budgetId:string|null;milestones:Partial<Record<LearningStep|'aha',string>>;skipped:LearningStep[];analyticsConsent:boolean;consentedAt:string|null;startedAt:string|null;updatedAt:string;completedAt:string|null};
export type OnboardingCommand={operation:'start';experience:'beginner'|'familiar';analyticsConsent:boolean}|{operation:'resume'|'pause'|'dismiss'|'review'|'finish'|'aha'}|{operation:'skip';step:'plan'|'purchase'}|{operation:'consent';enabled:boolean};
type RequestBody=OnboardingCommand&{expectedRevision:number;mutationId:string};
export type OnboardingController={state:OnboardingState|null;loading:boolean;busy:boolean;error:string;pending:boolean;refresh:()=>Promise<OnboardingState|null>;command:(command:OnboardingCommand)=>Promise<boolean>;retry:()=>Promise<boolean>;event:(step:LearningStep,kind:'viewed'|'action'|'blocked',reason?:'input'|'connection'|'conflict'|'session'|'access')=>void};
export function nextLearningStep(state:OnboardingState):LearningStep|'finish'{return learningSteps.find(step=>!state.milestones[step]&&!state.skipped.includes(step))??'finish';}
export function onboardingErrorReason(error:unknown):'input'|'connection'|'conflict'|'session'|'access'{if(error instanceof CloudError){if(error.status===0||error.status>=500)return 'connection';if(error.status===409)return 'conflict';if(error.status===401)return 'session';if([402,403].includes(error.status))return 'access';}return 'input';}

export function useOnboarding(userId?:string):OnboardingController{
 const [snapshot,setSnapshot]=useState<{userId:string;state:OnboardingState}|null>(null),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const currentUser=useRef(userId),latest=useRef<{userId:string;state:OnboardingState}|null>(null),pending=useRef<{userId:string;body:RequestBody}|null>(null),sending=useRef(false),mounted=useRef(true);
 currentUser.current=userId;
 const accept=useCallback((owner:string,state:OnboardingState)=>{if(!mounted.current||currentUser.current!==owner)return;if(latest.current?.userId===owner&&latest.current.state.revision>state.revision)return;latest.current={userId:owner,state};setSnapshot({userId:owner,state});},[]);
 const refresh=useCallback(async()=>{const owner=currentUser.current;if(!owner)return null;try{const state=await api<OnboardingState>('/onboarding');accept(owner,state);if(mounted.current&&currentUser.current===owner&&!pending.current)setError('');return state;}catch(cause){if(mounted.current&&currentUser.current===owner)setError(cause instanceof Error?cause.message:'Your setup progress could not be loaded.');return null;}},[accept]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{latest.current=null;pending.current=null;setSnapshot(null);setError('');setBusy(false);sending.current=false;if(!userId){setLoading(false);return;}setLoading(true);void refresh().finally(()=>{if(mounted.current&&currentUser.current===userId)setLoading(false);});const focus=()=>{if(document.visibilityState==='visible')void refresh();};window.addEventListener('focus',focus);return()=>window.removeEventListener('focus',focus);},[userId,refresh]);
 async function transmit(request:{userId:string;body:RequestBody}):Promise<boolean>{
  if(sending.current||request.userId!==currentUser.current)return false;sending.current=true;setBusy(true);setError('');
  try{
   let state:OnboardingState;
   try{state=await api<OnboardingState>('/onboarding/command',{method:'POST',body:request.body});}
   catch(cause){
    if(!(cause instanceof CloudError)||cause.code!=='ONBOARDING_CONFLICT')throw cause;
    const current=await api<OnboardingState>('/onboarding');accept(request.userId,current);request.body={...request.body,expectedRevision:current.revision};
    if(request.userId!==currentUser.current)return false;
    state=await api<OnboardingState>('/onboarding/command',{method:'POST',body:request.body});
   }
   if(request.userId!==currentUser.current)return false;accept(request.userId,state);pending.current=null;return true;
  }catch(cause){
   if(currentUser.current===request.userId&&mounted.current){
    if(cause instanceof CloudError&&cause.status>=400&&cause.status<500&&cause.status!==401){pending.current=null;void refresh();}
    setError(cause instanceof Error?cause.message:'Your setup change was not confirmed. Retry to keep your place.');
   }return false;
  }finally{if(currentUser.current===request.userId&&mounted.current){sending.current=false;setBusy(false);}}
 }
 async function command(value:OnboardingCommand){
  const owner=currentUser.current;if(!owner||sending.current)return false;
  if(pending.current?.userId===owner){setError('Retry the unconfirmed setup update first. Your budget remains available.');return false;}
  const state=latest.current?.userId===owner?latest.current.state:await refresh();if(!state||owner!==currentUser.current)return false;
  const request={userId:owner,body:{...value,expectedRevision:state.revision,mutationId:crypto.randomUUID()}};pending.current=request;return transmit(request);
 }
 function event(step:LearningStep,kind:'viewed'|'action'|'blocked',reason?:'input'|'connection'|'conflict'|'session'|'access'){
  const owner=currentUser.current,state=latest.current&&latest.current.userId===owner?latest.current.state:null;if(!owner||!state?.analyticsConsent||!state.startedAt)return;
  // No durable browser queue, free-form properties, field values, or third-party SDK.
  void api('/onboarding/event',{method:'POST',body:{step,kind,...(reason?{reason}:{})}}).catch(()=>{});
 }
 return {state:snapshot&&snapshot.userId===userId?snapshot.state:null,loading,busy,error,pending:!!pending.current&&pending.current.userId===userId,refresh,command,retry:async()=>pending.current?transmit(pending.current):!!await refresh(),event};
}

