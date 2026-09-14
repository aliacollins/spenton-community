import {describe,it,expect} from 'vitest';
import {blankBudget} from './engine';
import {budgetImportIssue} from './backup';

describe('personal-budget migration boundaries',()=>{
 it('keeps independent budgets portable and rejects stranded shared relationships',()=>{
  const budget=blankBudget();
  expect(budgetImportIssue(budget)).toBeNull();
  const linked={...budget,entries:[{id:'shared-purchase',kind:'expense' as const,amount:100,date:'2026-09-13',accountId:'cash',categoryId:'groceries',payee:'Example',note:'',cleared:false,sharedExpenseId:'shared-record'}]};
  const before=JSON.stringify(linked);
  expect(budgetImportIssue(linked)).toMatch(/complete server backup/);
  expect(JSON.stringify(linked)).toBe(before);
 });
});
