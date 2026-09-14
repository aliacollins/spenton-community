import { cents, money, thisMonth } from './engine';
import type { Budget, Category, CategoryTotal } from './engine';

export type TargetSettings=Pick<Category,'target'|'targetType'|'targetCap'|'targetDate'|'targetPausedMonths'>;

export function parseTargetFields(form:FormData,existing?:Category):TargetSettings{
 const value=(key:string)=>String(form.get(key)??'').trim();
 const target=cents(value('target')||'0');
 if(target<0)throw new Error('A goal amount cannot be negative.');
 const selected=value('targetType')||'monthly';
 if(!['monthly','balance','capped'].includes(selected))throw new Error('Choose a goal type.');
 const targetType=selected as Category['targetType'];
 const targetCap=targetType==='capped'?cents(value('targetCap')||'0'):undefined;
 if(targetCap!==undefined&&targetCap<=0)throw new Error('Enter a balance limit above zero.');
 const targetDate=targetType==='balance'?(value('targetDate')||undefined):undefined;
 if(targetDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)||Number.isNaN(Date.parse(targetDate))||new Date(targetDate+'T12:00:00Z').toISOString().slice(0,10)!==targetDate))throw new Error('Choose a valid goal date.');
 const month=value('targetMonth');
 const paused=new Set(existing?.targetPausedMonths??[]);
 if(month){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('Choose a valid month to pause.');
  if(form.get('targetPaused')==='on')paused.add(month);else paused.delete(month);
 }
 return {target,targetType,targetCap,targetDate,targetPausedMonths:paused.size?[...paused].sort():undefined};
}

export function targetSummary(c:Category,currency:Budget['currency']='USD',month=thisMonth()):string{
 if(c.target<=0)return 'No savings goal yet';
 if(c.targetPausedMonths?.includes(month))return 'Goal paused for this month';
 if(c.targetType==='capped')return `${money(c.target,currency)} each month, up to ${money(c.targetCap??0,currency)}`;
 if(c.targetType==='balance')return c.targetDate?`${money(c.target,currency)} by ${c.targetDate}`:`Build up to ${money(c.target,currency)}`;
 return `Set aside ${money(c.target,currency)} each month`;
}

export function targetProgress(c:Category,t:CategoryTotal,_month=thisMonth()):number{
 if(!c.target)return 0;
 if(c.targetType==='capped')return Math.max(0,Math.min(100,100*t.available/(c.targetCap??1)));
 if(c.targetType==='balance')return Math.max(0,Math.min(100,100*t.available/c.target));
 return Math.max(0,Math.min(100,100*t.assigned/c.target));
}

// A 12-month goal includes the selected budget month as contribution number one.
export function goalDateAfterMonths(month:string,count:string):string{
 if(!/^\d+$/.test(count)||Number(count)<1||Number(count)>600)return '';
 const [year,startMonth]=month.split('-').map(Number);
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return '';
 const end=new Date(Date.UTC(year,startMonth-1+Number(count),0));
 return end.toISOString().slice(0,10);
}
