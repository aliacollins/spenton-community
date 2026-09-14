import {describe,it,expect} from 'vitest';
import {blankBudget,validateBudget,calculate,allocate} from './engine';
import type {Budget,Entry} from './engine';
const date='2026-09-05';
const entry=(v:Partial<Entry>):Entry=>({id:crypto.randomUUID(),date,kind:'expense',amount:1,payee:'Fictional dinner',note:'',cleared:true,...v});
const base=(cash=10000):Budget=>validateBudget({...blankBudget(),version:2,accounts:[{id:'cash',name:'Bank',type:'checking',opening:cash,date:'2026-09-01'},{id:'card',name:'Visa',type:'credit',opening:0,date:'2026-09-01'}]});
const totals=(b:Budget)=>calculate(validateBudget(b),'2026-09');
const purchase=(accountId='cash')=>entry({id:'dinner',accountId,categoryId:'dining',amount:10000,sharedAmount:7500,sharedExpenseId:'shared'});
const charge=()=>entry({kind:'shared_charge',amount:2500,categoryId:'dining',sharedExpenseId:'shared',sharedShareId:'friend'});
const payment=(amount=2500)=>entry({kind:'shared_payment',amount,accountId:'cash',categoryId:'dining',sharedExpenseId:'shared',sharedShareId:'friend',sharedSettlementId:crypto.randomUUID()});
const receipt=(amount=7500)=>entry({kind:'shared_receipt',amount,accountId:'cash',sharedExpenseId:'shared',sharedShareId:'friend',sharedSettlementId:crypto.randomUUID()});
describe('unified shared-budget ledger',()=>{
 for(const account of ['cash','card'])it(`${account}: full bank movement, personal spending, nonspendable receivable`,()=>{
  let b=allocate(base(),'ready','dining',2500,'2026-09-01');b={...b,entries:[...b.entries,purchase(account)]};const t=totals(b);
  expect(t.spent).toBe(2500);expect(t.categories.dining.available).toBe(0);expect(t.shared.receivable).toBe(7500);expect(t.ready).toBe(0);expect(t.netWorth).toBe(7500);
  expect(t.balances[account]).toBe(account==='cash'?0:-10000);
  if(account==='card'){expect(t.cards.card.reserve).toBe(10000);expect(t.cash).toBe(10000);}
  const paid=totals({...b,entries:[...b.entries,receipt()]});expect(paid.shared.receivable).toBe(0);expect(paid.spent).toBe(2500);expect(paid.income).toBe(0);expect(paid.ready).toBe(7500);expect(paid.netWorth).toBe(7500);
 });
 it('does not take money from other funded categories to back fronted card debt',()=>{
  let b=allocate(base(),'ready','rent',7500,'2026-09-01');b=allocate(b,'ready','dining',2500,'2026-09-01');b={...b,entries:[...b.entries,purchase('card')]};
  const t=totals(b);expect(t.cards.card.reserve).toBe(2500);expect(t.cards.card.unbacked).toBe(7500);expect(t.categories.rent.available).toBe(7500);expect(t.categories.dining.available).toBe(0);expect(t.ready).toBe(0);
  const r=totals({...b,entries:[...b.entries,receipt(3000)]});expect(r.cards.card.reserve).toBe(5500);expect(r.cards.card.owed).toBe(10000);expect(r.ready).toBe(0);expect(r.shared.receivable).toBe(4500);
 });
 it('repayment after the card was paid restores cash without recording spending again',()=>{
  let b=allocate(base(),'ready','dining',2500,'2026-09-01');b={...b,entries:[...b.entries,purchase('card'),entry({kind:'payment',amount:10000,accountId:'cash',toAccountId:'card'}),receipt()]};
  const t=totals(b);expect(t.cash).toBe(7500);expect(t.ready).toBe(7500);expect(t.spent).toBe(2500);expect(t.cards.card.owed).toBe(0);
 });
 it('acceptance charges the category, holds actual cash and later payments do not spend again',()=>{
  let b=base();b={...b,entries:[charge()]};let t=totals(b);expect(t.cash).toBe(10000);expect(t.ready).toBe(7500);expect(t.spent).toBe(2500);expect(t.shared.owed).toBe(2500);expect(t.shared.reserved).toBe(2500);expect(t.netWorth).toBe(7500);
  b={...b,entries:[...b.entries,payment(1000)]};t=totals(b);expect(t.cash).toBe(9000);expect(t.shared.owed).toBe(1500);expect(t.shared.reserved).toBe(1500);expect(t.spent).toBe(2500);expect(t.ready).toBe(7500);
  t=totals({...b,entries:[...b.entries,payment(1500)]});expect(t.cash).toBe(7500);expect(t.shared.owed).toBe(0);expect(t.shared.reserved).toBe(0);expect(t.spent).toBe(2500);expect(t.netWorth).toBe(7500);
 });
 it('shows an unfunded share and never invents cash; later funding and payment conserve cash',()=>{
  let b=base(1000);b={...b,entries:[charge()]};let t=totals(b);expect(t.shared.reserved).toBe(1000);expect(t.shared.unfunded).toBe(1500);expect(t.categories.dining.available).toBe(-1500);expect(t.ready).toBe(0);
  b={...b,entries:[...b.entries,entry({kind:'income',amount:1500,accountId:'cash'})]};b=allocate(b,'ready','dining',1500,date);t=totals(b);expect(t.shared.reserved).toBe(2500);expect(t.shared.unfunded).toBe(0);expect(t.ready).toBe(0);
  t=totals({...b,entries:[...b.entries,payment()]});expect(t.cash).toBe(0);expect(t.spent).toBe(2500);expect(t.shared.reserved).toBe(0);
 });
 it('unfunded offline payment becomes cash overspending and can be covered once',()=>{
  let b=base(1000);b={...b,entries:[charge(),payment()]};let t=totals(b);expect(t.cash).toBe(-1500);expect(t.ready).toBe(-1500);expect(t.categories.dining.cash).toBe(-1500);expect(t.spent).toBe(2500);
  b={...b,entries:[...b.entries,entry({kind:'income',amount:1500,accountId:'cash'})]};b=allocate(b,'ready','dining',1500,date);t=totals(b);expect(t.ready).toBe(0);expect(t.cash).toBe(0);expect(t.categories.dining.available).toBe(0);
 });
 it('rejects double payments, missing links, oversettlement, and old schema silently losing data',()=>{
  expect(()=>totals({...base(),version:1,entries:[purchase()]})).toThrow(/version 2/);
  expect(()=>totals({...base(),entries:[payment()]})).toThrow(/accepted share/);
  expect(()=>totals({...base(),entries:[charge(),payment(2501)]})).toThrow(/within/);
  const p=payment(1000);expect(()=>totals({...base(),entries:[charge(),p,{...p,id:'duplicate'}]})).toThrow(/already recorded/);
  expect(()=>totals({...base(),entries:[purchase(),receipt(7501)]})).toThrow(/within/);
  expect(()=>totals({...base(),entries:[purchase(),entry({kind:'refund',amount:2501,accountId:'cash',categoryId:'dining',refundOf:'dinner'})]})).toThrow(/exceed/);
 });
 it('keeps category spending on purchase date and settlement out of later months',()=>{
  const b={...base(),entries:[purchase(),{...receipt(),date:'2026-10-01'}]};expect(calculate(validateBudget(b),'2026-09').shared.receivable).toBe(7500);expect(calculate(validateBudget(b),'2026-10').spent).toBe(0);expect(calculate(validateBudget(b),'2026-10').shared.receivable).toBe(0);
 });
});

import {previewSharedBudget} from './shared-budget';
import {categoryHistory,explainCategoryMonth} from './budget-history';
import {accountEffect,clearedBalance} from './reconciliation';
import {spendingComparison} from './insights';
describe('shared-budget previews and reports',()=>{
 it('previews match saved accounting without changing the source budget',()=>{
  const b={...base(),entries:[entry({id:'dinner',accountId:'cash',categoryId:'dining',amount:10000})]},before=JSON.stringify(b);
  const preview=previewSharedBudget(b,{kind:'split',entryId:'dinner',amount:'7500'},date);
  expect(preview.personalSpending).toBe(2500);expect(preview.categoryLeft).toBe(-2500);expect(preview.ready).toBe(0);expect(JSON.stringify(b)).toBe(before);
  const accepted=previewSharedBudget(base(1000),{kind:'accept',categoryId:'dining',amount:'2500',date},date);
  expect(accepted.reserved).toBe(1000);expect(accepted.unfunded).toBe(1500);expect(accepted.categoryLeft).toBe(-1500);
 });
 it('reconciliation records received money as an inflow; accepted shares have no bank effect',()=>{
  const b={...base(),entries:[purchase(),receipt()]};expect(accountEffect(receipt(),'cash')).toBe(7500);expect(clearedBalance(b,'cash',date)).toBe(7500);expect(accountEffect(charge(),'cash')).toBe(0);
 });
 it('category history includes personal spending and acceptance but excludes settlement',()=>{
  const b={...base(),entries:[purchase(),receipt()]};expect(explainCategoryMonth(b,'dining','2026-09').purchases).toBe(2500);expect(categoryHistory(b,'dining','2026-09').rows).toHaveLength(1);
  const owed={...base(),entries:[charge(),payment()]};expect(explainCategoryMonth(owed,'dining','2026-09').purchases).toBe(2500);expect(categoryHistory(owed,'dining','2026-09').rows).toHaveLength(1);
 });
 it('partial-month comparisons preserve earlier purchase links and exclude repayments',()=>{
  const b={...base(),entries:[{...purchase(),date:'2026-09-28'}, {...receipt(),date:'2026-10-02'}, {...charge(),date:'2026-10-03'}]};
  const result=spendingComparison(b,'2026-10','2026-10-05');expect(result.current).toBe(2500);expect(result.before).toBe(0);expect(result.available).toBe(false);
 });
 it('cash stays equal to unassigned money plus categories, cards and shared repayment cash',()=>{
  for(const account of ['cash','card'])for(const opening of [0,1000,10000,20000]){
   let b=base(opening);b={...b,entries:[purchase(account),charge(),payment(1000),receipt(3000)]};const t=totals(b);
   expect(t.cash).toBe(t.unassignedBeforeShortfalls+Object.values(t.categories).reduce((n,c)=>n+c.cash,0)+Object.values(t.cards).reduce((n,c)=>n+c.reserve,0)+t.shared.reserved);
   expect(t.spent).toBe(5000);expect(t.shared.receivable).toBe(4500);expect(t.shared.owed).toBe(1500);
  }
 });
});
