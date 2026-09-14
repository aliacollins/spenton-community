import {expect,it} from 'vitest';
import fc from 'fast-check';
import {allocate,blankBudget,calculate,validateBudget} from './engine';
import type {Budget,Entry} from './engine';

it('cash reimbursements conserve cash after partial card funding and payments without changing debt or income',()=>{
 fc.assert(fc.property(fc.integer({min:0,max:10000}),fc.integer({min:0,max:10000}),fc.integer({min:1,max:10000}),(funding,payment,reimbursement)=>{
  let b:Budget={...blankBudget(),accounts:[{id:'cash',name:'Cash',type:'checking',opening:100000,date:'2026-09-01',lastFour:''},{id:'card',name:'Card',type:'credit',opening:0,date:'2026-09-01',lastFour:''}]};
  if(funding)b=allocate(b,'ready','groceries',funding,'2026-09-01');
  const purchase:Entry={id:'purchase',kind:'expense',amount:10000,date:'2026-09-02',accountId:'card',categoryId:'groceries',payee:'Fictional meal',note:'',cleared:true};
  b=validateBudget({...b,entries:[...b.entries,purchase,...(payment?[{id:'card-payment',kind:'payment' as const,amount:payment,date:'2026-09-03',accountId:'cash',toAccountId:'card',payee:'',note:'',cleared:true}]:[])]});
  const before=calculate(b,'2026-09');
  b=validateBudget({...b,entries:[...b.entries,{id:'received',kind:'refund',amount:reimbursement,date:'2026-09-04',accountId:'cash',categoryId:'groceries',refundOf:'purchase',reimbursement:true,payee:'Repayment',note:'',cleared:true}]});
  const after=calculate(b,'2026-09');
  expect(after.cards.card.owed).toBe(before.cards.card.owed);expect(after.cards.card.credit).toBe(0);expect(after.income).toBe(0);expect(after.spent).toBe(10000-reimbursement);expect(after.cash).toBe(100000-payment+reimbursement);
  expect(after.cash).toBe(after.unassignedBeforeShortfalls+Object.values(after.categories).reduce((n,c)=>n+c.cash,0)+Object.values(after.cards).reduce((n,c)=>n+c.reserve,0));
 }),{numRuns:200});
});
