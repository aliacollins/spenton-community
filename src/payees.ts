import type { Budget, Entry } from './engine';

/** Suggestions belong to this budget and come only from explicitly recorded or scheduled transactions. */
export function savedPayees(budget:Budget,kind:Entry['kind']):string[]{
 const names=new Map<string,string>();
 for(const entry of [...budget.entries,...(budget.schedules??[]).map(schedule=>schedule.template)].reverse().sort((a,b)=>b.date.localeCompare(a.date))){
  const name=entry.payee.trim();
  if(entry.kind!==kind||!name||names.has(name.toLocaleLowerCase()))continue;
  names.set(name.toLocaleLowerCase(),name);
 }
 return [...names.values()].sort((a,b)=>a.localeCompare(b));
}

