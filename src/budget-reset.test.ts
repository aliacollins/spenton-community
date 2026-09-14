import {describe,expect,it} from 'vitest';
import {blankBudget,calculate,today,validateBudget} from './engine';
import type {Budget} from './engine';
import {budgetResetRestriction,freshBudgetForReplacement,resetBudget} from './budget-reset';

function budget(version:Budget['version']):Budget {
 return validateBudget({...blankBudget('INR'),version,accounts:[{id:'cash',name:'Cash',type:'checking',opening:100000,date:today()}],
  entries:[{id:'purchase',kind:'expense',amount:10000,date:today(),accountId:'cash',categoryId:'groceries',payee:'Lunch'}]});
}

describe('reset compatibility and shared history',()=>{
 for(const version of [2,3] as const)for(const mode of ['structure','factory'] as const){
  it(`resets an eligible version ${version} budget in ${mode} mode without downgrading it`,()=>{
   const original=budget(version),before=structuredClone(original),reset=resetBudget(original,mode);
   expect(reset.version).toBe(version);
   expect(reset.entries).toEqual([]);
   expect(calculate(reset,today().slice(0,7)).netWorth).toBe(0);
   expect(original).toEqual(before);
  });
 }
 it('retains format when replacing a budget with a fresh budget in another currency',()=>{
  const replacement=freshBudgetForReplacement(budget(3),'EUR');
  expect(replacement).toEqual({...blankBudget('EUR'),version:3});
 });
 it('refuses to clear shared spending, including a cancelled share with no amount left',()=>{
  for(const sharedAmount of [5000,0]){
   const original=budget(3);original.entries[0]={...original.entries[0],sharedExpenseId:'shared-bill',sharedAmount};
   const before=structuredClone(original);
   expect(budgetResetRestriction(original)).toContain('shared bills or repayments');
   expect(()=>resetBudget(original,'structure')).toThrow(/shared bills/);
   expect(()=>freshBudgetForReplacement(original)).toThrow(/shared bills/);
   expect(original).toEqual(before);
  }
 });
 it('keeps accepted-share and repayment history protected even without an owned purchase',()=>{
  const original=budget(2);
  original.entries=[{id:'share',kind:'shared_charge',amount:5000,date:today(),categoryId:'groceries',sharedExpenseId:'bill',sharedShareId:'person',payee:'Lunch',note:'',cleared:true}];
  expect(()=>resetBudget(validateBudget(original),'factory')).toThrow(/shared bills or repayments/);
 });
 it('distinguishes planned shares from ordinary future transactions',()=>{
  const original=budget(3);
  original.schedules=[{id:'future',frequency:'once',nextDate:'2099-01-01',template:{...original.entries[0],date:'2099-01-01'}}];
  expect(budgetResetRestriction(original)).toBeNull();
  expect(budgetResetRestriction(original,1)).toContain('scheduled shared bills');
 });
});
