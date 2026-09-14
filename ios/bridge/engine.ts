import { allocate, blankBudget, calculate, canUseAccountForEntry, cents, demoBudget, id, targetNeed, today, validateBudget } from '../../src/engine';
import type { Account, Budget, Category, Entry } from '../../src/engine';
import {previewSharedBudget} from '../../src/shared-budget';
import {defaultStarters,pipStarterNames,starterSuggestions} from '../../src/starter-categories';
import {planGroupBill} from '../../src/group-bill-plan';
import {previewGroupBill} from '../../src/group-bill-preview';
import {clearedBalance, reconcile} from '../../src/reconciliation';
import {postOccurrence, skipOccurrence, saveTransaction, nextOccurrence} from '../../src/recurring';
import type {RepeatInterval} from '../../src/recurring';

// The native UI calls this bundled module through JavaScriptCore, never a webview.
// Keep financial rules in the existing engine and preserve the complete document.
export function recordedBudget(budget: Budget, date: string): Budget {
  return { ...budget, accounts: budget.accounts.map(a => a.date > date ? { ...a, opening: 0 } : a), entries: budget.entries.filter(e => e.date <= date) };
}

export function overview(input: unknown, date = today()) {
  const budget = validateBudget(input), month = date.slice(0, 7);
  const totals = calculate(recordedBudget(budget, date), month);
  return {
    name: budget.name, currency: budget.currency, date, groups: [...new Set([...(budget.groups ?? []), ...budget.categories.map(c => c.group)])], ready: totals.ready, spent: totals.spent,
    cash: totals.cash, netWorth: totals.netWorth, shared: totals.shared,
    upcomingBills: (budget.schedules ?? []).map(s => ({ id: s.id, date: s.nextDate, amount: s.template.amount, payee: s.template.payee, accountName: budget.accounts.find(a => a.id === s.template.accountId)?.name ?? '',template:s.template,kind:s.template.kind,frequency:s.frequency })),
    categories: budget.categories.map(c => ({ ...c, ...totals.categories[c.id], needed: targetNeed(c, totals.categories[c.id], month) })),
    accounts: budget.accounts.map(a => ({ ...a, balance: totals.balances[a.id], card: totals.cards[a.id] ?? null })),
    transactions: totals.transactions.map(e => ({ ...e,
      accountName: budget.accounts.find(a => a.id === e.accountId)?.name ?? '',
      categoryName: e.splits ? 'Split purchase' : budget.categories.find(c => c.id === e.categoryId)?.name ?? '',
      destinationName: budget.accounts.find(a => a.id === e.toAccountId)?.name ?? '',
    })),
  };
}

export function change(input: unknown, command: Record<string, string>, date = today()): Budget {
  if (command.kind === 'reconcile') {
    const budget = validateBudget(input), through = command.date || date, target = cents(command.amount);
    if (target !== clearedBalance(budget, command.accountId, through) && command.reviewed !== 'true') {
      throw new Error('Review missing and duplicate entries before adding an adjustment.');
    }
    return reconcile(budget, command.accountId, through, target, command.note || '');
  }
  if (command.kind === 'goal') {
    const budget = validateBudget(input), category = budget.categories.find(c => c.id === command.categoryId);
    if (!category) throw new Error('This category is no longer available.');
    const target = cents(command.amount || '0');
    return validateBudget({...budget, categories: budget.categories.map(c => c.id === category.id ? {
      ...c, target, targetType: command.targetType || 'balance',
      targetCap: command.targetType === 'capped' ? cents(command.targetCap || '0') : undefined,
      targetDate: command.targetDate || undefined,
    } : c)});
  }
  if (command.kind === 'statement') {
    const budget = validateBudget(input), account = budget.accounts.find(a => a.id === command.accountId && a.type === 'credit');
    if (!account) throw new Error('Choose a credit-card account.');
    const statement = {amount:cents(command.amount || '0'),minimum:cents(command.minimum || '0'),closed:command.closed,due:command.due};
    if (statement.minimum > statement.amount || statement.closed > date || statement.due < statement.closed) throw new Error('Check the statement dates, total and minimum payment.');
    return validateBudget({...budget, accounts:budget.accounts.map(a => a.id === account.id ? {...a,statement} : a)});
  }
  if (command.kind === 'editEntry') {
    const budget = validateBudget(input), entry = budget.entries.find(e => e.id === command.entryId);
    if (!entry) throw new Error('This transaction is no longer available.');
    if (entry.sharedExpenseId && command.date && command.date !== entry.date) throw new Error('Use the shared bill correction to change its date.');
    if ((command.date || entry.date) > date) throw new Error('A recorded transaction cannot move into the future.');
    return validateBudget({...budget,entries:budget.entries.map(e => e.id === entry.id ? {
      ...e,payee:command.payee?.trim() || e.payee,note:command.note ?? e.note,date:command.date || e.date,
    } : e)});
  }
  if (command.kind === 'refund') {
    const budget = validateBudget(input), entry = budget.entries.find(e => e.id === command.entryId && e.kind === 'expense');
    if (!entry || entry.sharedExpenseId || entry.sharedSettlementId) throw new Error('Use the shared bill review for a shared refund.');
    const amount = cents(command.amount);
    if (amount <= 0 || (command.date || date) > date) throw new Error('Enter a positive refund received today or earlier.');
    return validateBudget({...budget,entries:[...budget.entries,{id:id(),kind:'refund',amount,date:command.date||date,
      accountId:entry.accountId,categoryId:command.categoryId||entry.categoryId,refundOf:entry.id,
      payee:entry.payee,note:command.note||'',cleared:false}]});
  }
  if (command.kind === 'postSchedule') return postOccurrence(validateBudget(input),command.scheduleId,date);
  if (command.kind === 'skipSchedule') return skipOccurrence(validateBudget(input),command.scheduleId);
  if (command.kind === 'clearing') {
    const budget = validateBudget(input), entry = budget.entries.find(e => e.id === command.entryId);
    if (!entry || !entry.accountId || entry.date > date) throw new Error('This transaction changed. Reopen Activity before changing its status.');
    const field = command.side === 'destination' ? 'clearedTo' : 'cleared';
    if (field === 'clearedTo' && !entry.toAccountId) throw new Error('This transaction has no receiving account.');
    if (String(entry[field] ?? entry.cleared) !== command.expectedCleared) throw new Error('This status changed on another device. Check its current status first.');
    if (!['true','false'].includes(command.cleared)) throw new Error('Choose cleared or uncleared.');
    return validateBudget({ ...budget, entries: budget.entries.map(e => e.id === entry.id ? { ...e, [field]: command.cleared === 'true' } : e) });
  }
  if (command.kind === 'recordBill') {
    const budget = validateBudget(input), schedule = budget.schedules?.find(s => s.id === command.scheduleId && s.frequency === 'once' && s.template.receiptId);
    if (!schedule) throw new Error('This bill changed or was removed. Reopen it before recording payment.');
    return validateBudget({ ...budget, schedules: budget.schedules!.filter(s => s.id !== schedule.id), entries: [...budget.entries, { ...schedule.template, id: id(), date, accountId: command.accountId || schedule.template.accountId, cleared: false }] });
  }
  let budget = validateBudget(input),scheduleKey:string|undefined;
  if(command.scheduleId){
    const scheduled=budget.schedules?.find(s=>s.id===command.scheduleId);
    if(!scheduled)throw new Error('This bill has already been recorded or is no longer scheduled.');
    if(scheduled.template.kind!==command.kind)throw new Error('Keep the scheduled transaction type when recording it.');
    if(command.scheduleDate&&scheduled.nextDate!==command.scheduleDate)throw new Error('This scheduled date changed. Reopen it before recording payment.');
    if(scheduled.template.receiptId&&scheduled.template.receiptId!==command.receiptId)throw new Error('Keep the original bill attached to this payment.');
    scheduleKey=scheduled.id+':'+scheduled.nextDate;
    if(budget.entries.some(e=>e.scheduleKey===scheduleKey))throw new Error('This occurrence is already recorded.');
    budget={...budget,schedules:budget.schedules!.flatMap(s=>s.id!==scheduled.id?[s]:s.frequency==='once'?[]:[{...s,nextDate:nextOccurrence(s)}])};
  }
  const amount = cents(command.amount);
  if (amount <= 0) throw new Error('Enter an amount greater than zero.');
  if (command.kind === 'allocation') {
    const planned = allocate(recordedBudget(budget, date), command.from || 'ready', command.categoryId, amount, date);
    return validateBudget({ ...budget, entries: [...budget.entries, planned.entries[planned.entries.length - 1]] });
  }
  if (!['expense', 'income', 'payment', 'transfer'].includes(command.kind)) throw new Error('Choose a supported transaction type.');
  const kind = command.kind as Entry['kind'];
  const account = budget.accounts.find(a => a.id === command.accountId);
  if (!account || !canUseAccountForEntry(account, kind)) throw new Error('Choose an account for this transaction.');
  let splits:Entry['splits'];
  if(kind==='expense'&&command.splits){
    const input=JSON.parse(command.splits);
    if(!Array.isArray(input)||input.length<2||input.length>100||new Set(input.map(p=>p.categoryId)).size!==input.length)throw new Error('Choose each category once.');
    splits=input.map(p=>({categoryId:p.categoryId,amount:cents(p.amount)}));
  }
  const entry: Entry = { id: id(), kind, amount, date: command.date || date, accountId: account.id,
    payee: command.payee?.trim() || ({ expense: 'Purchase', income: 'Income', payment: 'Card payment', transfer: 'Transfer' } as Record<string, string>)[kind],
    note: command.note?.trim() || '', cleared: command.cleared !== 'false',
    ...(command.receiptId ? { receiptId: command.receiptId } : {}),
    ...(scheduleKey?{scheduleKey}:{}),
    ...(kind === 'expense' ? splits ? {splits} : { categoryId: command.categoryId } : {}),
    ...(['payment', 'transfer'].includes(kind) ? { toAccountId: command.toAccountId, clearedTo: command.cleared !== 'false' } : {}),
  };
  const frequency=(command.repeat||'none') as RepeatInterval;
  if(!['none','weekly','monthly','yearly'].includes(frequency))throw new Error('Choose a valid repeat interval.');
  if (command.upcoming === 'true') {
    if (kind !== 'expense') throw new Error('An upcoming bill must be a purchase.');
    return validateBudget({ ...budget, schedules: [...(budget.schedules ?? []), { id: id(), frequency: frequency==='none'?'once':frequency, nextDate: entry.date, template: { ...entry, scheduleKey:undefined, cleared: false } }] });
  }
  return saveTransaction(budget,entry,frequency,undefined,date);
}

export function create(command: Record<string, string>, date = today()): Budget {
  const budget = blankBudget(command.currency as Budget['currency']);
  const opening = cents(command.amount || '0');
  return validateBudget({ ...budget, name: command.name.trim() || 'My budget',
    accounts: [{ id: id(), name: command.accountName.trim() || 'Everyday account', type: 'checking', opening, date, lastFour: '' }],
  });
}

export function createOnboarding(command: Record<string, string>, date = today()): Budget {
  const plan = JSON.parse(command.plan);
  if (!plan || typeof plan.name !== 'string' || !plan.name.trim() || typeof plan.accountName !== 'string' || !plan.accountName.trim()) throw new Error('Name your budget and account before continuing.');
  if (!['checking','savings'].includes(plan.accountType)) throw new Error('Choose an everyday or savings account.');
  if (!Array.isArray(plan.categories) || plan.categories.length < 1 || plan.categories.length > 500) throw new Error('Choose at least one category.');
  const opening = cents(plan.balance || '0');
  if (opening < 0) throw new Error('Start with a cash balance of zero or more. Add other accounts after setup.');
  let budget = validateBudget({...blankBudget(plan.currency), name: plan.name.trim(), categories: plan.categories.map((c: Category) => ({
    id: c.id, name: c.name, group: c.group, icon: c.icon, color: c.color, ...(c.parentId ? {parentId:c.parentId}:{}), target:0,targetType:'monthly',
  })), accounts:[{id:plan.accountID,name:plan.accountName.trim(),type:plan.accountType,opening,date,lastFour:''}]});
  for (const category of plan.categories) {
    const amount = cents(category.amount || '0');
    if (amount < 0) throw new Error('Set aside zero or more in each category.');
    if (amount) budget = allocate(budget,'ready',category.id,amount,date);
  }
  if (command.complete === 'true' && calculate(budget,date.slice(0,7)).ready !== 0) throw new Error('Give the remaining money a purpose before saving.');
  return validateBudget(budget);
}

export function structure(input: unknown, command: Record<string, string>, date = today()): Budget {
  const budget = validateBudget(input);
  const name = command.name?.trim();
  if (!name || name.length > 80) throw new Error('Enter a name with 1 to 80 characters.');
  if (!command.id || budget.accounts.some(a => a.id === command.id) || budget.categories.some(c => c.id === command.id)) throw new Error('This item could not be added. Close this form and try again.');
  if (command.kind === 'category') {
    if (budget.categories.length >= 500) throw new Error('This budget already has 500 categories.');
    const parent = command.parentId ? budget.categories.find(c => c.id === command.parentId) : undefined;
    if (command.parentId && (!parent || parent.parentId)) throw new Error('Choose an existing main category.');
    const group = parent?.group ?? command.group?.trim();
    if (!group || group.length > 60) throw new Error('Enter a group name with 1 to 60 characters.');
    if (budget.categories.some(c => c.name.toLocaleLowerCase() === name.toLocaleLowerCase() && c.group === group && (c.parentId ?? '') === (parent?.id ?? ''))) throw new Error('This category already exists here. Choose it from the category list or use another name.');
    const category: Category = { id: command.id, name, group, ...(parent ? { parentId: parent.id } : {}), icon: command.icon || 'basket', color: command.color || 'sage', target: 0, targetType: 'monthly' };
    return validateBudget({ ...budget, categories: [...budget.categories, category] });
  }
  if (command.kind !== 'account') throw new Error('Choose an account or category to add.');
  if (budget.accounts.length >= 100) throw new Error('This budget already has 100 accounts.');
  if (!['checking', 'savings', 'credit', 'investment'].includes(command.type)) throw new Error('Choose an account type.');
  if (budget.accounts.some(a => a.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('An account with this name already exists. Choose another name.');
  const amount = cents(command.amount || '0');
  if (amount < 0) throw new Error('Enter an amount of zero or more, then choose whether it is money owed.');
  const negative = command.type === 'credit' ? command.position !== 'credit' : ['checking', 'savings'].includes(command.type) && command.position === 'overdrawn';
  const account: Account = { id: command.id, name, type: command.type as Account['type'], opening: negative ? -amount : amount, date, lastFour: '' };
  const added = validateBudget({ ...budget, accounts: [...budget.accounts, account] });
  const reserve = cents(command.reserve || '0');
  if (reserve < 0 || (reserve > 0 && (account.type !== 'credit' || account.opening >= 0 || reserve > -account.opening))) throw new Error('Cash set aside must be between zero and the opening card debt.');
  if (!reserve) return added;
  // Apply only recorded cash, while preserving all existing future entries.
  const funded = allocate(recordedBudget(added, date), 'ready', 'card:' + account.id, reserve, date);
  return validateBudget({ ...added, entries: [...added.entries, funded.entries[funded.entries.length - 1]] });
}

export function run(raw: string): string {
  try {
    const request = JSON.parse(raw);
    const date = request.date || today();
    let result;
    switch (request.action) {
      case 'overview': result = overview(request.budget, date); break;
      case 'validate': result = validateBudget(request.budget); break;
      case 'change': result = change(request.budget, request.command, date); break;
      case 'create': result = create(request.command, date); break;
      case 'onboardingCatalog': result = starterSuggestions.filter(s=>pipStarterNames.includes(s[1])).map(([group,name,icon,color])=>({group,name,icon,color,selected:defaultStarters.includes(name)})); break;
      case 'categoryCatalog': result = starterSuggestions.map(([group,name,icon,color])=>({group,name,icon,color,selected:false})); break;
      case 'createOnboarding': result = createOnboarding(request.command, date); break;
      case 'structure': result = structure(request.budget, request.command, date); break;
      case 'sharedPreview': result = previewSharedBudget(validateBudget(request.budget), request.command, date); break;
      case 'parseAmount': result = cents(request.command.amount || '0'); break;
      case 'reconcilePreview': {
        const budget=validateBudget(request.budget),account=budget.accounts.find(a=>a.id===request.command.accountId);
        if(!account)throw new Error('Choose an account.');
        const through=request.command.date||date,cleared=clearedBalance(budget,account.id,through),target=cents(request.command.amount||'0');
        result={cleared,target,difference:target-cleared};break;
      }
      case 'groupBillPlan': result = planGroupBill(JSON.parse(request.command.plan)); break;
      case 'groupBillPreview': result = previewGroupBill(validateBudget(request.budget),planGroupBill(JSON.parse(request.command.plan)),request.command.memberId,request.command.accountId,request.command.categoryId,request.command.date,request.command.merchant); break;
      case 'sample': result = demoBudget(); break;
      default: throw new Error('This action is unavailable.');
    }
    return JSON.stringify({ result });
  } catch (error) {
    // Schema internals are not useful product copy and can contain input values.
    const message = error instanceof Error && error.name !== 'ZodError' ? error.message : 'Check the entered details and try again.';
    return JSON.stringify({ error: message });
  }
}
