import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { allocate, blankBudget, calculate, canUseAccountForEntry, validateBudget } from './engine';
import type { Budget, Entry } from './engine';
import { reconcile } from './reconciliation';

const month='2026-09',date='2026-09-01';
function budget():Budget {
 return validateBudget({...blankBudget(),accounts:[
  {id:'bank',name:'Bank',type:'checking',opening:100000,date,lastFour:''},
  {id:'invest',name:'Investments',type:'investment',opening:900000,date,lastFour:''},
  {id:'retirement',name:'Retirement',type:'investment',opening:200000,date,lastFour:''},
  {id:'card',name:'Card',type:'credit',opening:0,date,lastFour:''},
 ],categories:[{id:'food',name:'Food',group:'Living',icon:'basket',color:'sage',target:0,targetType:'monthly'}]});
}
function add(b:Budget,entry:Partial<Entry>):Budget {
 return validateBudget({...b,entries:[...b.entries,{id:'entry-'+b.entries.length,kind:'transfer',accountId:'bank',toAccountId:'invest',amount:10000,date,payee:'Transfer',note:'',cleared:true,...entry}]});
}
function conserved(b:Budget){
 const t=calculate(b,month);
 expect(t.cash).toBe(t.unassignedBeforeShortfalls+Object.values(t.categories).reduce((n,c)=>n+c.cash,0)+Object.values(t.cards).reduce((n,c)=>n+c.reserve,0));
 expect(t.netWorth).toBe(Object.values(t.balances).reduce((n,value)=>n+value,0));
}

describe('investment accounts outside the spending budget',()=>{
 it('includes existing investments only in net worth and preserves them through export/import',()=>{
  const b=validateBudget(JSON.parse(JSON.stringify(budget()))),t=calculate(b,month);
  expect(t.cash).toBe(100000);expect(t.ready).toBe(100000);expect(t.netWorth).toBe(1200000);
  expect(t.balances.invest).toBe(900000);expect(t.income).toBe(0);expect(t.spent).toBe(0);
  expect(()=>allocate(b,'ready','food',100001,date)).toThrow(/not enough/);conserved(b);
 });
 it('deducts a contribution from available money without changing spending, categories or net worth',()=>{
  let b=allocate(budget(),'ready','food',40000,date);
  b=add(b,{amount:25000});const t=calculate(b,month);
  expect(t.cash).toBe(75000);expect(t.ready).toBe(35000);expect(t.categories.food.available).toBe(40000);
  expect(t.balances.invest).toBe(925000);expect(t.netWorth).toBe(1200000);expect(t.spent).toBe(0);conserved(b);
 });
 it('makes withdrawals available only when money returns to a budget account',()=>{
  const b=add(budget(),{accountId:'invest',toAccountId:'bank',amount:30000}),t=calculate(b,month);
  expect(t.ready).toBe(130000);expect(t.cash).toBe(130000);expect(t.balances.invest).toBe(870000);
  expect(t.income).toBe(0);expect(t.spent).toBe(0);expect(t.netWorth).toBe(1200000);conserved(b);
 });
 it('does not release planned category or card money when a transfer exceeds unplanned cash',()=>{
  let b=allocate(budget(),'ready','food',90000,date);
  b=add(b,{amount:20000});const t=calculate(b,month);
  expect(t.ready).toBe(-10000);expect(t.categories.food.available).toBe(90000);
  expect(()=>allocate(b,'ready','food',1,date)).toThrow(/not enough/);
  b=allocate(b,'food','ready',10000,date);expect(calculate(b,month).ready).toBe(0);conserved(b);
 });
 it('keeps transfers between investments and future transfers outside current planning',()=>{
  let b=add(budget(),{accountId:'invest',toAccountId:'retirement',amount:50000});
  b=add(b,{date:'2026-10-01',amount:20000});const current=calculate(b,month);
  expect(current.ready).toBe(100000);expect(current.balances.retirement).toBe(250000);
  expect(calculate(b,'2026-10').ready).toBe(80000);conserved(b);
 });
 it('records changes in investment value without creating spendable cash or income',()=>{
  let b=budget();expect(()=>reconcile(b,'invest',date,950000)).toThrow(/reason/);
  b=reconcile(b,'invest',date,950000,'Provider value after market change');
  let t=calculate(b,month);expect(t.balances.invest).toBe(950000);expect(t.netWorth).toBe(1250000);
  expect(t.ready).toBe(100000);expect(t.cash).toBe(100000);expect(t.income).toBe(0);expect(t.spent).toBe(0);
  b=reconcile(b,'invest',date,820000,'Provider value after market decline');t=calculate(b,month);
  expect(t.balances.invest).toBe(820000);expect(t.ready).toBe(100000);expect(t.income).toBe(0);expect(t.spent).toBe(0);conserved(b);
 });
 it('rejects treating an investment account as a spending account or payment source',()=>{
  for(const kind of ['income','expense','payment'] as const){
   expect(canUseAccountForEntry({type:'investment'},kind)).toBe(false);
   expect(()=>add(budget(),{kind,accountId:'invest',toAccountId:kind==='payment'?'card':undefined,categoryId:kind==='expense'?'food':undefined})).toThrow(/Investment accounts/);
  }
  expect(canUseAccountForEntry({type:'investment'},'transfer')).toBe(true);
  expect(()=>add(budget(),{accountId:'card',toAccountId:'invest'})).toThrow(/Transfers/);
 });
 it('leaves card debt and its cash untouched when investment values change',()=>{
  let b=allocate(budget(),'ready','food',40000,date);
  b=add(b,{kind:'expense',accountId:'card',toAccountId:undefined,categoryId:'food',amount:10000});
  const before=calculate(b,month);
  b=reconcile(b,'invest',date,950000,'Market value update');
  const after=calculate(b,month);
  expect(after.cards).toEqual(before.cards);expect(after.categories).toEqual(before.categories);
  expect(after.ready).toBe(before.ready);expect(after.cash).toBe(before.cash);conserved(b);
 });
 it('keeps the budget boundary and cash conservation across mixed transfers',()=>{
  fc.assert(fc.property(fc.array(fc.record({from:fc.integer({min:0,max:2}),to:fc.integer({min:0,max:2}),amount:fc.integer({min:1,max:100000})}),{maxLength:40}),moves=>{
   let b=budget();const accounts=['bank','invest','retirement'];let expected=100000;
   for(const move of moves){if(move.from===move.to)continue;b=add(b,{accountId:accounts[move.from],toAccountId:accounts[move.to],amount:move.amount});expected+=(move.to===0?move.amount:0)-(move.from===0?move.amount:0);conserved(b);}
   const t=calculate(b,month);expect(t.ready).toBe(expected);expect(t.cash).toBe(expected);expect(t.netWorth).toBe(1200000);expect(t.income).toBe(0);expect(t.spent).toBe(0);
  }),{numRuns:100});
 });
});
