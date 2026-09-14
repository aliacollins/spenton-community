import { validateBudget, today, type Budget } from './engine.ts';
import {nextOccurrence} from './recurring.ts';

/** Append one reviewed purchase and any records created inside its editor. */
export function appendSharedPurchase(budget: Budget, input: unknown): Budget {
  if (!input || typeof input !== 'object') throw new Error('Review the purchase before saving its split.');
  const draft = input as Record<string, unknown>;
  const entry = draft.entry as Record<string, unknown> | undefined;
  const accounts = draft.accounts ?? [], categories = draft.categories ?? [], allocations = draft.allocations ?? [];
  if (!entry || entry.kind !== 'expense' || typeof entry.id !== 'string'
      || typeof entry.date !== 'string' || entry.date > today()
      || Object.keys(entry).some(key => !['id','kind','amount','date','accountId','categoryId','splits','payee','note','cleared','receiptId','scheduleKey'].includes(key))
      || !Array.isArray(accounts) || !Array.isArray(categories) || !Array.isArray(allocations)) {
    throw new Error('Review one purchase, account and category before saving the split.');
  }
  const newCards = new Set(accounts.filter(a => a?.type === 'credit').map(a => 'card:' + a.id));
  if (allocations.some(a => !a || a.kind !== 'allocation' || a.from !== 'ready' || !newCards.has(a.to))) {
    throw new Error('Only cash set aside for a new card can accompany this purchase.');
  }
  let schedules=budget.schedules;
  if(draft.schedule!==undefined){
    const saved=draft.schedule as Record<string,unknown>;
    const original=budget.schedules?.find(s=>s.id===saved?.id);
    const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical((value as Record<string,unknown>)[key])])):value;
    if(!original||JSON.stringify(canonical(original))!==JSON.stringify(canonical(saved))||(original.template.receiptId&&original.template.receiptId!==entry.receiptId)||entry.scheduleKey!==original.id+':'+original.nextDate)throw new Error('Review the current scheduled bill before recording it.');
    if(original.frequency==='once')schedules=budget.schedules!.filter(s=>s.id!==original.id);
    else {
      const next={...original,nextDate:nextOccurrence(original)};
      if(JSON.stringify(canonical(draft.nextSchedule))!==JSON.stringify(canonical(next)))throw new Error('Keep the next scheduled occurrence.');
      schedules=budget.schedules!.map(s=>s.id===original.id?next:s);
    }
  }
  else if(entry.scheduleKey)throw new Error('A scheduled payment needs its original occurrence.');
  return validateBudget({
    ...budget,
    accounts: [...budget.accounts, ...accounts],
    categories: [...budget.categories, ...categories],
    entries: [...budget.entries, ...allocations, entry],
    ...(schedules?{schedules}:{}),
  });
}
