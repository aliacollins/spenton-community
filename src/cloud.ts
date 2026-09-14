import { validateBudget } from './engine';
import type { Budget } from './engine';

export type CloudUser={id:string;email:string;isAdmin:boolean;lastSignInMethod?:'password'|'google'|'microsoft'|'apple'|null};
export type CloudBudget={id:string;revision:number;updatedAt:string;budget:Budget;subscriptionVersion?:number;plannedShares?:{scheduleId:string}[];ownerTest?:boolean};
export type BudgetSummary=Omit<CloudBudget,'budget'>&{name:string};
export type Usage={budgetCredits:number;budgetLimit:number;budgetCount:number;accessExpiresAt:string|null};
export type BudgetMutation={budget:Budget;expectedRevision:number;mutationId:string;reviewed:true;serviceAction?:'budget.saved'|'import.completed'};

export class CloudError extends Error {
 constructor(public status:number,public code:string,message:string){super(message);}
}

export async function api<T>(path:string,options:{method?:'GET'|'POST'|'PUT'|'DELETE';body?:unknown;signal?:AbortSignal}={}):Promise<T>{
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),20000);
 const signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;
 try{
  const response=await fetch('/api'+path,{method:options.method??'GET',credentials:'include',cache:'no-store',headers:options.body===undefined?{}:{'Content-Type':'application/json'},body:options.body===undefined?undefined:JSON.stringify(options.body),signal});
  const raw=await response.text();
  let payload:unknown;
  try{payload=raw?JSON.parse(raw):undefined;}catch{throw new CloudError(response.status,'SERVICE_UNAVAILABLE','The service returned an unexpected response. Try again shortly.');}
  if(!response.ok){const error=(payload as {error?:{code?:string;message?:string}})?.error;throw new CloudError(response.status,error?.code??'REQUEST_FAILED',error?.message??'This request could not be completed.');}
  return payload as T;
 }catch(error){
  if(error instanceof CloudError)throw error;
  if(options.signal?.aborted)throw error;
  throw new CloudError(0,'CONNECTION_FAILED','The server could not confirm this request. Check your connection and try again.');
 }finally{clearTimeout(timer);}
}

export function validateSnapshot(value:CloudBudget):CloudBudget {
 if(!value||typeof value.id!=='string'||!Number.isSafeInteger(value.revision)||value.revision<1||typeof value.updatedAt!=='string')throw new CloudError(502,'INVALID_SNAPSHOT','The saved budget could not be verified. Your current view has been kept.');
 const budget=validateBudget(value.budget);
 if(budget.demo)throw new CloudError(502,'INVALID_SNAPSHOT','This account returned an invalid budget.');
 return {...value,budget};
}
export const getBudget=async(id:string,ownerTest=false)=>validateSnapshot(await api<CloudBudget>((ownerTest?'/owner-tests/':'/budgets/')+encodeURIComponent(id)));
export const putBudget=async(id:string,mutation:BudgetMutation,ownerTest=false)=>validateSnapshot(await api<CloudBudget>((ownerTest?'/owner-tests/':'/budgets/')+encodeURIComponent(id),{method:'PUT',body:mutation}));
