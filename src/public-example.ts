import { allocate, calculate, validateBudget } from './engine';
import type { Budget } from './engine';

// Fixed fictional records. No browser storage, account access or API requests.
export function sharedDinnerExample(received = 0) {
  const date = '2026-01-01';
  let budget: Budget = {
    version: 2, name: 'Public dinner example', currency: 'USD', demo: true,
    accounts: [{ id: 'cash', name: 'Example bank', type: 'checking', opening: 50000, date, lastFour: '' }],
    categories: [
      { id: 'bills', name: 'Bills', group: 'My plan', icon: 'home', color: 'sage', target: 30000, targetType: 'monthly' },
      { id: 'dining', name: 'Dining', group: 'My plan', icon: 'food', color: 'peach', target: 12000, targetType: 'monthly' },
    ],
    entries: [],
  };
  budget = allocate(budget, 'ready', 'bills', 30000, date);
  budget = allocate(budget, 'ready', 'dining', 12000, date);
  budget.entries.push({
    id: 'dinner', date, kind: 'expense', accountId: 'cash', categoryId: 'dining',
    amount: 12000, sharedAmount: 8000, sharedExpenseId: 'shared-dinner',
    payee: 'Example dinner', note: '', cleared: true,
  });
  if (received) budget.entries.push({
    id: 'received', date, kind: 'shared_receipt', accountId: 'cash', amount: received,
    sharedExpenseId: 'shared-dinner', sharedShareId: 'example-friends',
    sharedSettlementId: 'example-repayment', payee: 'Example friends', note: '', cleared: true,
  });
  return calculate(validateBudget(budget), '2026-01');
}
