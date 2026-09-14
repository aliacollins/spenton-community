import { id, today, validateBudget } from './engine.ts';
import type { Budget, Entry, Schedule } from './engine.ts';

export type RepeatInterval='none'|'weekly'|'monthly'|'yearly';

export function assertScheduleCurrent(b:Budget,original:Schedule):void {
 const current=b.schedules?.find(s=>s.id===original.id);
 if(!current||JSON.stringify(current)!==JSON.stringify(original))throw new Error('This scheduled transaction changed or was removed. Reopen it to review the latest version.');
}

export function updateSchedule(b:Budget,original:Schedule,entry:Entry,frequency:RepeatInterval):Budget {
 assertScheduleCurrent(b,original);
 if(b.entries.some(e=>e.scheduleKey===original.id+':'+entry.date))throw new Error('This scheduled date is already recorded. Choose a different date.');
 const accountStart=b.accounts.filter(a=>a.id===entry.accountId||a.id===entry.toAccountId).map(a=>a.date).sort().at(-1)??'';
 const anchor=entry.date!==original.nextDate||original.template.date<accountStart?entry.date:original.template.date;
 const updated:Schedule={...original,nextDate:entry.date,frequency:frequency==='none'?'once':frequency,template:{...entry,id:original.template.id,date:anchor,cleared:false,clearedTo:false,importKey:undefined,scheduleKey:undefined}};
 if(original.subscription!==undefined&&(entry.kind!=='expense'||frequency==='none'))updated.subscription=false;
 return validateBudget({...b,schedules:b.schedules!.map(s=>s.id===original.id?updated:s)});
}

export function saveTransaction(b:Budget,entry:Entry,frequency:RepeatInterval,existingId?:string,through=today()):Budget {
 if(existingId){
  if(entry.date>through)throw new Error('A recorded transaction cannot move into the future. Add a scheduled entry instead.');
  if(!b.entries.some(e=>e.id===existingId))throw new Error('This transaction no longer exists. Reopen it before editing.');
  return validateBudget({...b,entries:b.entries.map(e=>e.id===existingId?entry:e)});
 }
 const future=entry.date>through;
 let next={...b,entries:future?b.entries:[...b.entries,entry]};
 if(future||frequency!=='none'){
  const schedule:Schedule={id:id(),frequency:frequency==='none'?'once':frequency,nextDate:entry.date,template:{...entry,id:id(),cleared:false,clearedTo:false,importKey:undefined,scheduleKey:undefined}};
  if(!future)schedule.nextDate=nextOccurrence(schedule);
  next={...next,schedules:[...(b.schedules??[]),schedule]};
 }
 return validateBudget(next);
}

export function nextOccurrence(schedule:Schedule):string {
 if(schedule.frequency==='once')throw new Error('This entry does not repeat.');
 const [year,month,day]=schedule.nextDate.split('-').map(Number);
 const anchor=Number(schedule.template.date.slice(8));
 const next=new Date(schedule.nextDate+'T12:00:00Z');
 if(schedule.frequency==='weekly')next.setUTCDate(day+7);
 else {
  next.setUTCDate(1);
  if(schedule.frequency==='monthly')next.setUTCMonth(month);
  else next.setUTCFullYear(year+1);
  const last=new Date(Date.UTC(next.getUTCFullYear(),next.getUTCMonth()+1,0)).getUTCDate();
  next.setUTCDate(Math.min(anchor,last));
 }
 return next.toISOString().slice(0,10);
}

// Each occurrence is explicitly confirmed; expected income never funds the budget.
export function postOccurrence(b:Budget,scheduleId:string,through=today()):Budget {
 const schedule=b.schedules?.find(s=>s.id===scheduleId);
 if(!schedule)throw new Error('This scheduled transaction no longer exists.');
 if(schedule.nextDate>through)throw new Error('This entry is not due yet.');
 const key=schedule.id+':'+schedule.nextDate;
 const entry={...schedule.template,id:id(),date:schedule.nextDate,scheduleKey:key,importKey:undefined,cleared:false};
 return validateBudget({...b,entries:b.entries.some(e=>e.scheduleKey===key)?b.entries:[...b.entries,entry],schedules:advanceSchedule(b.schedules!,scheduleId)});
}

function advanceSchedule(schedules:Schedule[],scheduleId:string):Schedule[]{
 return schedules.flatMap(s=>s.id!==scheduleId?[s]:s.frequency==='once'?[]:[{...s,nextDate:nextOccurrence(s)}]);
}
export function skipOccurrence(b:Budget,scheduleId:string):Budget {
 return validateBudget({...b,schedules:advanceSchedule(b.schedules??[],scheduleId)});
}
