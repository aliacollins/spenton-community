import {id,validateBudget} from './engine.ts';
import type {Budget,Entry,Schedule} from './engine.ts';
import {assertScheduleCurrent} from './recurring.ts';

export type SubscriptionFrequency=Exclude<Schedule['frequency'],'once'>;
export type SubscriptionFlag={scheduleId:string;subscription:boolean};
export const canTrackSubscription=(schedule:Schedule)=>schedule.frequency!=='once'&&schedule.template.kind==='expense';
export const trackedSubscriptions=(budget:Budget)=>(budget.schedules??[]).filter(s=>s.subscription&&canTrackSubscription(s))
 .sort((a,b)=>a.nextDate.localeCompare(b.nextDate)||a.template.payee.localeCompare(b.template.payee)||a.id.localeCompare(b.id));

export function subscriptionCosts(schedules:Schedule[]){
 // Round once, after adding exact minor-unit amounts. Weekly estimates use 52 payments.
 const annual=schedules.filter(s=>s.subscription&&canTrackSubscription(s)).reduce((sum,s)=>sum+BigInt(s.template.amount)*BigInt(s.frequency==='weekly'?52:s.frequency==='monthly'?12:1),0n);
 const safe=(amount:bigint)=>amount<=BigInt(Math.floor(Number.MAX_SAFE_INTEGER/4))?Number(amount):null;
 return {annual:safe(annual),monthly:safe((annual+6n)/12n)};
}

export function addSubscription(budget:Budget,entry:Entry,frequency:SubscriptionFrequency):Budget {
 if(entry.kind!=='expense'||!entry.payee.trim())throw new Error('Enter the subscription name and expense details.');
 const schedule:Schedule={id:id(),frequency,nextDate:entry.date,subscription:true,template:{...entry,id:id(),cleared:false,clearedTo:false,importKey:undefined,scheduleKey:undefined}};
 return validateBudget({...budget,schedules:[...(budget.schedules??[]),schedule]});
}

export function trackSubscriptions(budget:Budget,schedules:Schedule[],tracked=true):Budget {
 if(!schedules.length)throw new Error('Choose at least one recurring expense.');
 for(const schedule of schedules){
  assertScheduleCurrent(budget,schedule);
  if(!canTrackSubscription(schedule))throw new Error('Choose a weekly, monthly or yearly expense.');
 }
 const ids=new Set(schedules.map(s=>s.id));
 return validateBudget({...budget,schedules:(budget.schedules??[]).map(s=>ids.has(s.id)?{...s,subscription:tracked}:s)});
}

// Old clients omit fields they do not understand. Keep the saved choice for
// surviving recurring expenses; explicit false remains a deliberate opt-out.
export function retainedSubscriptionFlags(previous:Budget,submitted:Budget):SubscriptionFlag[]{
 const saved=new Map(previous.schedules?.map(s=>[s.id,s.subscription]));
 return (submitted.schedules??[]).flatMap(s=>s.subscription===undefined&&canTrackSubscription(s)&&saved.get(s.id)!==undefined
  ?[{scheduleId:s.id,subscription:saved.get(s.id)!}]:[]);
}
export function applySubscriptionFlags(budget:Budget,flags:SubscriptionFlag[]=[]):Budget {
 if(!flags.length)return budget;
 const choices=new Map(flags.map(flag=>[flag.scheduleId,flag.subscription]));
 return validateBudget({...budget,schedules:budget.schedules?.map(s=>choices.has(s.id)?{...s,subscription:choices.get(s.id)!}:s)});
}
