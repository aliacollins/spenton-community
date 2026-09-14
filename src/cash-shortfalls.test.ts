import { describe, expect, it } from 'vitest';
import { allocate, allocationCapacity, blankBudget, calculate, validateBudget } from './engine';
import type { Budget, Entry } from './engine';
const month='2026-09',date='2026-09-08';
function budget(opening=45000000):Budget{return {...blankBudget('INR'),accounts:[{id:'cash',name:'Bank',type:'checking',date,opening,lastFour:''},{id:'savings',name:'Savings',type:'savings',date,opening:0,lastFour:''},{id:'card',name:'Card',type:'credit',date,opening:0,lastFour:''}],entries:[]};}
function record(b:Budget,amount:number,extra:Partial<Entry>={}):Budget{return validateBudget({...b,entries:[...b.entries,{id:'entry-'+b.entries.length,kind:'expense',date,amount,accountId:'cash',categoryId:'groceries',payee:'Local market',cleared:true,note:'',...extra}]});}
function conserved(b:Budget){const t=calculate(b,month);expect(t.cash).toBe(t.ready+Object.values(t.categories).reduce((s,c)=>s+Math.max(0,c.cash),0)+Object.values(t.cards).reduce((s,c)=>s+Math.max(0,c.reserve),0));return t;}

describe('cash actually available to plan',()=>{
 it('shows a 50,000 shortfall after spending 500,000 from 450,000 unassigned cash',()=>{
  const b=record(budget(),50000000),t=conserved(b);
  expect(t.cash).toBe(-5000000);expect(t.ready).toBe(-5000000);expect(t.cashShortfall).toBe(50000000);expect(t.unassignedBeforeShortfalls).toBe(45000000);
  expect(t.categories.groceries.available).toBe(-50000000);expect(t.spent).toBe(50000000);
  expect(()=>allocate(b,'ready','dining',1,date)).toThrow(/not enough/);
 });
 it('can assign already spent unassigned money without subtracting the expense twice',()=>{
  let b=record(budget(),50000000);
  expect(allocationCapacity(calculate(b,month),'ready','groceries')).toBe(45000000);
  b=allocate(b,'ready','groceries',45000000,date);const t=conserved(b);
  expect(t.ready).toBe(-5000000);expect(t.cashShortfall).toBe(5000000);expect(t.categories.groceries.assigned).toBe(45000000);expect(t.categories.groceries.available).toBe(-5000000);
  expect(()=>allocate(b,'ready','groceries',1,date)).toThrow(/not enough/);
 });
 it('subtracts an unplanned cash purchase immediately, keeps funded purchases from counting twice',()=>{
  let b=record(budget(100000),20000);expect(conserved(b).ready).toBe(80000);
  b=allocate(b,'ready','groceries',20000,date);expect(conserved(b).ready).toBe(80000);
  b=allocate(b,'ready','groceries',30000,date);expect(conserved(b).ready).toBe(50000);
  b=record(b,10000);const t=conserved(b);expect(t.ready).toBe(50000);expect(t.categories.groceries.cash).toBe(20000);expect(t.cash).toBe(70000);
 });
 it('does not make consumed cash available to a different category or card',()=>{
  const b=record(budget(100000),90000);
  expect(()=>allocate(b,'ready','dining',10001,date)).toThrow(/not enough/);
  expect(()=>allocate(b,'ready','card:card',10001,date)).toThrow(/not enough/);
  const assigned=allocate(b,'ready','groceries',100000,date);expect(conserved(assigned).ready).toBe(0);
 });
 it('deducts a card payment made without a reserve and permits assigning it afterward',()=>{
  let b=record(budget(100000),20000,{accountId:'card'});expect(conserved(b).ready).toBe(100000);
  b=record(b,20000,{kind:'payment',categoryId:undefined,toAccountId:'card'});expect(conserved(b).ready).toBe(80000);
  b=allocate(b,'ready','card:card',20000,date);const t=conserved(b);expect(t.ready).toBe(80000);expect(t.cards.card.reserve).toBe(0);expect(t.spent).toBe(20000);
 });
 it('reflects refunds and carries the actual shortfall across months',()=>{
  let b=record(budget(100000),120000);expect(conserved(b).ready).toBe(-20000);
  expect(calculate(b,'2026-10').ready).toBe(-20000);
  b=record(b,30000,{kind:'refund',refundOf:'entry-0'});expect(conserved(b).ready).toBe(10000);
  b=allocate(b,'ready','groceries',90000,date);expect(conserved(b).ready).toBe(10000);
 });
 it('updates only the selected account, while budgeting the combined cash',()=>{
  let b=budget(100000);b.accounts[1].opening=50000;
  b=record(b,20000,{accountId:'savings',payee:'Corner store'});const t=conserved(b);
  expect(t.balances.cash).toBe(100000);expect(t.balances.savings).toBe(30000);expect(t.cash).toBe(130000);expect(t.ready).toBe(130000);expect(b.entries[0].payee).toBe('Corner store');
 });
});
