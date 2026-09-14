import {allocate, calculate, money, validateBudget} from './engine';
import type {Budget} from './engine';

// Public, fictional examples only. This module never reads or saves an account.
function example(bill: number, people: number, received: boolean) {
  const date = '2026-01-01';
  const friendsShare = Math.floor(bill / people) * (people - 1);
  let budget: Budget = {
    version: 2, name: 'Shared dinner example', currency: 'USD', demo: true,
    accounts: [{id: 'cash', name: 'Example bank', type: 'checking', opening: 50000, date, lastFour: ''}],
    categories: [
      {id: 'bills', name: 'Bills', group: 'My plan', icon: 'home', color: 'sage', target: 30000, targetType: 'monthly'},
      {id: 'dining', name: 'Dining', group: 'My plan', icon: 'food', color: 'peach', target: 12000, targetType: 'monthly'},
    ],
    entries: [],
  };
  budget = allocate(budget, 'ready', 'bills', 30000, date);
  budget = allocate(budget, 'ready', 'dining', 12000, date);
  budget.entries.push({
    id: 'dinner', date, kind: 'expense', accountId: 'cash', categoryId: 'dining',
    amount: bill, sharedAmount: friendsShare, sharedExpenseId: 'shared-dinner',
    payee: 'Example dinner', note: '', cleared: true,
  });
  if (received) budget.entries.push({
    id: 'received', date, kind: 'shared_receipt', accountId: 'cash',
    amount: friendsShare, sharedExpenseId: 'shared-dinner', sharedShareId: 'example-friends',
    sharedSettlementId: 'example-repayment', payee: 'Example friends', note: '', cleared: true,
  });
  return calculate(validateBudget(budget), '2026-01');
}

const root = document.getElementById('shared-example');
if (root) {
  const bill = root.querySelector<HTMLInputElement>('#shared-bill')!;
  const participants = root.querySelectorAll<HTMLButtonElement>('[data-people]');
  const received = root.querySelector<HTMLButtonElement>('#shared-received')!;
  const reset = root.querySelector<HTMLButtonElement>('#shared-reset')!;
  let people = 3, isReceived = false;
  const text = (selector: string, value: string) => { root.querySelector<HTMLElement>(selector)!.textContent = value; };
  function render() {
    const amount = Number(bill.value) * 100;
    const totals = example(amount, people, isReceived);
    text('#shared-bill-label', money(amount));
    text('#shared-personal', money(totals.spent));
    text('#shared-owed', money(totals.shared.receivable));
    text('#shared-left', money(totals.categories.dining.available));
    text('#shared-bank', money(totals.cash));
    text('#shared-ready', money(totals.ready));
    text('#shared-status', isReceived
      ? 'Repayments recorded. Your spending stays the same.'
      : 'You paid the bill. Only your share counts as spending.');
    text('#shared-explanation', totals.categories.dining.available < 0
      ? `Your share is ${money(-totals.categories.dining.available)} more than the $120 set aside for Dining. Your budget shows the shortfall.`
      : isReceived
        ? 'Received money returns to your bank balance. It is not new income, and the dinner is not counted again.'
        : 'Money friends owe you is not available to plan. Record it only after you receive it.');
    text('#shared-received', isReceived ? 'Undo example repayment' : 'Try recording all repayments');
    received.setAttribute('aria-pressed', String(isReceived));
    bill.setAttribute('aria-valuetext', money(amount));
    root!.querySelector('#shared-left')!.classList.toggle('amount-shortfall', totals.categories.dining.available < 0);
    root!.querySelector('#shared-ready')!.classList.toggle('amount-shortfall', totals.ready < 0);
    participants.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.people) === people)));
  }
  bill.addEventListener('input', () => { isReceived = false; render(); });
  participants.forEach(button => button.addEventListener('click', () => {
    people = Number(button.dataset.people); isReceived = false; render();
  }));
  received.addEventListener('click', () => { isReceived = !isReceived; render(); });
  reset.addEventListener('click', () => { bill.value = '120'; people = 3; isReceived = false; render(); });
  root.querySelectorAll<HTMLElement>('[data-interactive]').forEach(element => { element.hidden = false; });
}
