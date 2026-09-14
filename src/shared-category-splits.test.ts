import {describe,expect,it} from 'vitest';
import {allocate,blankBudget,calculate,personalCategoryParts,proportionalAmounts,validateBudget} from './engine';
import type {Budget,Entry} from './engine';
import {categoryHistory} from './budget-history';
import {previewSharedBudget} from './shared-budget';
import {appendSharedPurchase} from './shared-purchase';

const date='2026-09-05';
const entry=(values:Partial<Entry>):Entry=>({id:crypto.randomUUID(),kind:'expense',date,amount:1,payee:'Fixture',note:'',cleared:true,...values});
const base=(cash=20000,credit=0):Budget=>validateBudget({...blankBudget(),version:3,accounts:[
 {id:'cash',name:'Bank',type:'checking',opening:cash,date:'2026-09-01'},
 {id:'card',name:'Card',type:'credit',opening:credit,date:'2026-09-01'},
]});
const purchase=(accountId='cash',amount=10000,sharedAmount=5000):Entry=>entry({
 id:'purchase',accountId,amount,sharedAmount,sharedExpenseId:'bill',
 splits:[{categoryId:'groceries',amount:Math.ceil(amount*.7)},{categoryId:'dining',amount:amount-Math.ceil(amount*.7)}],
});
const totals=(budget:Budget)=>calculate(validateBudget(budget),'2026-09');
const refund=(id:string,amount:number,sharedAmount:number,accountId='cash'):Entry=>entry({
 id,kind:'shared_refund',accountId,amount,sharedAmount,sharedReduction:sharedAmount,sharedExpenseId:'bill',refundOf:'purchase',
});

describe('a purchase with both category amounts and people',()=>{
 for(const account of ['cash','card'])it(`${account}: records the full purchase once and spends only the personal portions`,()=>{
  let b=allocate(base(),'ready','groceries',3500,date);b=allocate(b,'ready','dining',1500,date);
  b={...b,entries:[...b.entries,purchase(account)]};
  const result=totals(b);
  expect(result.spent).toBe(5000);
  expect(result.categories.groceries.spent).toBe(3500);expect(result.categories.dining.spent).toBe(1500);
  expect(result.shared.receivable).toBe(5000);expect(result.netWorth).toBe(15000);
  expect(result.balances[account]).toBe(account==='cash'?10000:-10000);
  expect(result.ready).toBe(10000);
  expect(result.cash).toBe(result.unassignedBeforeShortfalls+Object.values(result.categories).reduce((n,c)=>n+c.cash,0)+Object.values(result.cards).reduce((n,c)=>n+c.reserve,0)+result.shared.reserved);
  if(account==='card')expect(result.cards.card.reserve).toBe(10000);
  expect(categoryHistory(b,'groceries','2026-09').rows.filter(r=>r.kind==='expense')[0].amount).toBe(3500);
 });
 it('uses existing card credit for personal portions before fronted debt',()=>{
  const b={...base(20000,4000),entries:[purchase('card')]},t=totals(b);
  expect(t.balances.card).toBe(-6000);expect(t.cards.card.reserve).toBe(5000);expect(t.cards.card.unbacked).toBe(1000);
  expect(t.categories.groceries.available).toBe(0);expect(t.categories.dining.available).toBe(-1000);
  expect(t.shared.receivable).toBe(5000);
 });
 for(const account of ['cash','card'])it(`${account}: partial shared refunds restore each personal category and reduce the receivable once`,()=>{
  let b=allocate(base(),'ready','groceries',3500,date);b=allocate(b,'ready','dining',1500,date);
  b={...b,entries:[...b.entries,purchase(account),refund('refund',2000,1000,account)]};
  const t=totals(b);
  expect(t.spent).toBe(4000);expect(t.shared.receivable).toBe(4000);
  expect(t.categories.groceries.spent).toBe(2800);expect(t.categories.dining.spent).toBe(1200);
  expect(t.balances[account]).toBe(account==='cash'?12000:-8000);
  expect(categoryHistory(b,'groceries','2026-09').rows.find(r=>r.kind==='shared_refund')?.amount).toBe(700);
  if(account==='card')expect(t.cards.card.reserve).toBe(8000);
 });
 it('successive penny refunds cannot return more than a category originally spent',()=>{
  const bought=entry({id:'purchase',accountId:'cash',amount:4,sharedAmount:2,sharedExpenseId:'bill',splits:[{categoryId:'groceries',amount:2},{categoryId:'dining',amount:2}]});
  const b={...base(),entries:[bought,refund('one',2,1),refund('two',2,1)]};
  const t=totals(b);expect(t.spent).toBe(0);expect(t.categories.groceries.spent).toBe(0);expect(t.categories.dining.spent).toBe(0);expect(t.shared.receivable).toBe(0);
  expect(()=>totals({...b,entries:[...b.entries,refund('extra',1,0)]})).toThrow();
 });
 it('received repayments do not create another purchase or category expense',()=>{
  const b={...base(),entries:[purchase(),entry({kind:'shared_receipt',amount:3000,accountId:'cash',sharedExpenseId:'bill',sharedShareId:'maya',sharedSettlementId:'paid'})]};
  const t=totals(b);expect(t.spent).toBe(5000);expect(t.income).toBe(0);expect(t.shared.receivable).toBe(2000);expect(t.cash).toBe(13000);
 });
 it('previews and atomic purchase drafts use the same category rules',()=>{
  const original=base();
  const {sharedExpenseId:_,sharedAmount:__,...unshared}=purchase();
  const staged=appendSharedPurchase(original,{entry:unshared,accounts:[],categories:[],allocations:[]});
  const preview=previewSharedBudget(staged,{kind:'split',entryId:'purchase',amount:'5000'},date);
  expect(preview.personalSpending).toBe(5000);expect(preview.categoryAmounts?.map(p=>p.spent)).toEqual([3500,1500]);
  expect(original.entries).toHaveLength(0);
 });
 it('keeps large-value and odd-cent allocations exact',()=>{
  const amounts=proportionalAmounts(999999999999,[{categoryId:'a',amount:700000000000},{categoryId:'b',amount:300000000000}]);
  expect(amounts.reduce((n,p)=>n+p.amount,0)).toBe(999999999999);
  const parts=personalCategoryParts(purchase('cash',10001,6667));
  expect(parts.reduce((n,p)=>n+p.amount,0)).toBe(3334);
 });
});
