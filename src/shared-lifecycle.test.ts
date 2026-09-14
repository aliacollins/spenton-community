import {describe,it,expect} from 'vitest';
import {allocate,blankBudget,calculate,effectiveEntries,validateBudget} from './engine';
import type {Budget,Entry} from './engine';
import {clearedBalance} from './reconciliation';

const date='2026-09-05';
const entry=(input:Partial<Entry>):Entry=>({id:crypto.randomUUID(),date,kind:'expense',amount:1,payee:'Fictional trip',note:'',cleared:true,...input});
const base=(cash=2_000_000):Budget=>validateBudget({...blankBudget(),version:3,accounts:[{id:'cash',name:'Bank',type:'checking',opening:cash,date:'2026-09-01'},{id:'card',name:'Card',type:'credit',opening:0,date:'2026-09-01'}]});
const totals=(budget:Budget)=>calculate(validateBudget(budget),'2026-09');
const conserve=(budget:Budget)=>{const t=totals(budget);expect(t.cash).toBe(t.unassignedBeforeShortfalls+Object.values(t.categories).reduce((n,c)=>n+c.cash,0)+Object.values(t.cards).reduce((n,c)=>n+c.reserve,0)+t.shared.reserved);};

describe('shared offsets and correction ledger',()=>{
 it('the four-person INR trip settles in six direct payments with each person spending 5250',()=>{
  const paid=[1_000_000,400_000,200_000,500_000];
  const budgets=paid.map((amount,i)=>validateBudget({...base(),currency:'INR',entries:[
   entry({id:'purchase:'+i,amount,accountId:'cash',categoryId:'dining',sharedExpenseId:'bill:'+i,sharedAmount:amount*3/4}),
   ...paid.flatMap((other,j)=>i===j?[]:[entry({kind:'shared_charge',amount:other/4,categoryId:'dining',sharedExpenseId:'bill:'+j,sharedShareId:`${j}:to:${i}`})]),
  ]}));
  for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){
   const amount=Math.min(paid[i],paid[j])/4,offsetId=`offset:${i}:${j}`;
   for(const [owner,other] of [[i,j],[j,i]])budgets[owner].entries.push(entry({kind:'shared_offset',date:'2026-09-06',amount,categoryId:'dining',sharedExpenseId:'bill:'+owner,sharedShareId:`${other}:to:${owner}`,againstExpenseId:'bill:'+other,sharedSettlementId:offsetId}));
  }
  for(let i=0;i<4;i++){expect(totals(budgets[i]).balances.cash).toBe(2_000_000-paid[i]);expect(totals(budgets[i]).spent).toBe(525_000);conserve(budgets[i]);}
  let payments=0;
  for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){
   const amount=Math.abs(paid[i]-paid[j])/4;if(!amount)continue;payments++;
   const receiver=paid[i]>paid[j]?i:j,sender=receiver===i?j:i,share=`${receiver}:to:${sender}`,settlement=`payment:${i}:${j}`;
   budgets[sender].entries.push(entry({kind:'shared_payment',date:'2026-09-07',amount,accountId:'cash',categoryId:'dining',sharedExpenseId:'bill:'+receiver,sharedShareId:share,sharedSettlementId:settlement}));
   budgets[receiver].entries.push(entry({kind:'shared_receipt',date:'2026-09-07',amount,accountId:'cash',sharedExpenseId:'bill:'+receiver,sharedShareId:share,sharedSettlementId:settlement}));
  }
  expect(payments).toBe(6);
  for(const budget of budgets){const t=totals(budget);expect(t.spent).toBe(525_000);expect(t.income).toBe(0);expect(t.cash).toBe(1_475_000);expect(t.shared.receivable).toBe(0);expect(t.shared.owed).toBe(0);conserve(budget);}
 });

 it('offsets release only actual excess repayment cash and can fund fronted card debt',()=>{
  let budget=allocate(base(1000),'ready','rent',1000,'2026-09-01');
  budget={...budget,entries:[...budget.entries,
   entry({id:'p',amount:2000,accountId:'card',categoryId:'dining',sharedExpenseId:'mine',sharedAmount:1000}),
   entry({kind:'shared_charge',amount:1000,categoryId:'dining',sharedExpenseId:'theirs',sharedShareId:'owed'}),
   entry({kind:'shared_offset',amount:1000,categoryId:'dining',sharedExpenseId:'mine',sharedShareId:'owed',againstExpenseId:'theirs',sharedSettlementId:'offset'}),
  ]};
  const t=totals(budget);expect(t.cash).toBe(1000);expect(t.categories.rent.cash).toBe(1000);expect(t.cards.card.reserve).toBe(0);expect(t.cards.card.owed).toBe(2000);expect(t.shared.receivable).toBe(0);expect(t.shared.owed).toBe(0);conserve(budget);
 });

 for(const account of ['cash','card'])it(`a refund after partial repayment preserves ${account} cash, spending and the return obligation`,()=>{
  const payer=base(100000),recipient=base(100000);
  payer.entries=[entry({id:'purchase',amount:10000,accountId:account,categoryId:'dining',sharedExpenseId:'dinner',sharedAmount:4000}),entry({kind:'shared_receipt',amount:2000,accountId:'cash',sharedExpenseId:'dinner',sharedShareId:'friend',sharedSettlementId:'paid'})];
  recipient.entries=[entry({kind:'shared_charge',amount:4000,categoryId:'dining',sharedExpenseId:'dinner',sharedShareId:'friend'}),entry({kind:'shared_payment',amount:2000,accountId:'cash',categoryId:'dining',sharedExpenseId:'dinner',sharedShareId:'friend',sharedSettlementId:'paid'})];
  payer.entries.push(entry({kind:'shared_refund',amount:6000,accountId:account,categoryId:'dining',refundOf:'purchase',sharedExpenseId:'dinner',sharedAmount:2400,sharedReduction:2000}),
   entry({kind:'shared_return',amount:400,categoryId:'dining',sharedExpenseId:'refund',sharedShareId:'return'}));
  recipient.entries.push(entry({kind:'shared_credit',amount:2400,categoryId:'dining',sharedExpenseId:'dinner',sharedShareId:'friend',sharedReduction:2000}),
   entry({kind:'shared_claim',amount:400,categoryId:'dining',sharedExpenseId:'refund',sharedShareId:'return'}));
  expect(totals(payer).spent).toBe(2400);expect(totals(recipient).spent).toBe(1600);
  expect(totals(payer).shared.owed).toBe(400);expect(totals(recipient).shared.receivable).toBe(400);
  payer.entries.push(entry({kind:'shared_payment',amount:400,accountId:'cash',categoryId:'dining',sharedExpenseId:'refund',sharedShareId:'return',sharedSettlementId:'returned'}));
  recipient.entries.push(entry({kind:'shared_receipt',amount:400,accountId:'cash',sharedExpenseId:'refund',sharedShareId:'return',sharedSettlementId:'returned'}));
  const a=totals(payer),b=totals(recipient);expect(a.netWorth).toBe(97600);expect(b.netWorth).toBe(98400);expect(a.income+b.income).toBe(0);expect(a.shared.owed+b.shared.receivable).toBe(0);if(account==='card')expect(a.cards.card.owed).toBe(4000);conserve(payer);conserve(recipient);
 });

 it('a reviewed repayment reversal keeps the record but removes its bank effect exactly once',()=>{
  const budget=base(10000),payment=entry({id:'payment',kind:'shared_payment',amount:1000,accountId:'cash',categoryId:'dining',sharedExpenseId:'bill',sharedShareId:'share',sharedSettlementId:'settlement'});
  budget.entries=[entry({kind:'shared_charge',amount:2000,categoryId:'dining',sharedExpenseId:'bill',sharedShareId:'share'}),payment,
   entry({kind:'shared_void',amount:1000,categoryId:'dining',sharedExpenseId:'bill',sharedShareId:'share',reversalOf:'payment',note:'Payment was entered twice.'})];
  expect(totals(budget).cash).toBe(10000);expect(totals(budget).shared.owed).toBe(2000);expect(totals(budget).spent).toBe(2000);expect(clearedBalance(budget,'cash',date)).toBe(10000);expect(budget.entries).toContain(payment);expect(effectiveEntries(budget)).not.toContain(payment);conserve(budget);
  expect(()=>validateBudget({...budget,entries:[...budget.entries,{...budget.entries[2],id:'again'}]})).toThrow(/reversal/);
  expect(()=>validateBudget({...budget,version:2})).toThrow(/version 3/);
 });
});
