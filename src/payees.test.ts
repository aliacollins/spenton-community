import {describe,it,expect} from 'vitest';
import {blankBudget} from './engine';
import type {Budget,Entry} from './engine';
import {savedPayees} from './payees';
const entry=(name:string,kind:Entry['kind']='expense'):Entry=>({id:name,kind,payee:name,amount:100,date:'2026-09-08',note:'',cleared:true,accountId:'cash',categoryId:'food'});
describe('budget payees',()=>{
 it('deduplicates names, trims spaces, and remembers explicit scheduled payees',()=>{
  const budget:Budget={...blankBudget(),entries:[entry(' old shop '),entry('Old Shop'),entry('Salary','income')],schedules:[{id:'planned',frequency:'monthly',nextDate:'2026-10-08',template:entry('Future shop')}]};
  expect(savedPayees(budget,'expense')).toEqual(['Future shop','Old Shop']);
  expect(savedPayees(budget,'income')).toEqual(['Salary']);
 });
 it('never suggests names from another budget',()=>{
  const first={...blankBudget(),entries:[entry('Private payee A')]};
  const second={...blankBudget(),entries:[entry('Private payee B')]};
  expect(savedPayees(first,'expense')).toEqual(['Private payee A']);
  expect(savedPayees(second,'expense')).toEqual(['Private payee B']);
  expect(savedPayees(blankBudget(),'expense')).toEqual([]);
 });
});
