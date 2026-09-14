import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { allocate, blankBudget, calculate, validateBudget } from './engine';
import type { Budget, Entry } from './engine';
import { clearedBalance, isCleared, reconcile, reconciliationSignature, setCleared } from './reconciliation';

function base():Budget{return {...blankBudget(),accounts:[{id:'cash',name:'Cash',type:'checking',opening:100000,date:'2026-01-01',lastFour:''},{id:'card',name:'Card',type:'credit',opening:0,date:'2026-01-01',lastFour:'',statement:{amount:5000,minimum:500,closed:'2026-01-01',due:'2026-01-20'}}]};}
const purchase:Entry={id:'purchase',kind:'expense',date:'2026-01-02',accountId:'card',categoryId:'groceries',amount:10000,payee:'Shop',note:'',cleared:true};
function add(b:Budget,e:Partial<Entry>&Pick<Entry,'id'|'kind'|'amount'>):Budget{return validateBudget({...b,entries:[...b.entries,{date:'2026-01-03',accountId:'card',payee:'Shop',note:'',cleared:true,...e}]});}
const refund=(b:Budget,amount:number,extra:Partial<Entry>={})=>add(b,{id:'refund',kind:'refund',amount,refundOf:'purchase',categoryId:'groceries',...extra});
function conserve(b:Budget,month='2026-01'){const t=calculate(b,month);expect(t.cash).toBe(t.unassignedBeforeShortfalls+Object.values(t.categories).reduce((n,c)=>n+c.cash,0)+Object.values(t.cards).reduce((n,c)=>n+c.reserve,0));expect(t.cash).toBe(t.ready+Object.values(t.categories).reduce((n,c)=>n+Math.max(0,c.cash),0)+Object.values(t.cards).reduce((n,c)=>n+Math.max(0,c.reserve),0));return t;}

describe('linked refunds',()=>{
 it('releases funding for an unpaid purchase and leaves statement obligations unchanged',()=>{
  let b=allocate(base(),'ready','groceries',10000,'2026-01-01');b=add(b,purchase);b=refund(b,6000);
  const t=conserve(b);expect(t.cards.card.reserve).toBe(4000);expect(t.categories.groceries.cash).toBe(6000);expect(t.cards.card.owed).toBe(4000);expect(t.spent).toBe(4000);expect(t.income).toBe(0);expect(t.cards.card.statementRemaining).toBe(5000);expect(t.cards.card.minimumRemaining).toBe(500);
 });
 it('reverses unfunded spending without creating cash',()=>{const t=conserve(refund(add(base(),purchase),6000));expect(t.categories.groceries.cash).toBe(0);expect(t.categories.groceries.unfunded).toBe(4000);expect(t.cards.card.reserve).toBe(0);});
 it('keeps a refund after repayment as restricted issuer credit',()=>{let b=add(allocate(base(),'ready','groceries',10000,'2026-01-01'),purchase);b=add(b,{id:'pay',kind:'payment',amount:10000,accountId:'cash',toAccountId:'card'});b=refund(b,10000,{date:'2026-02-01'});const t=conserve(b,'2026-02');expect(t.cash).toBe(90000);expect(t.categories.groceries.cash).toBe(0);expect(t.cards.card.credit).toBe(10000);expect(t.spent).toBe(-10000);expect(t.income).toBe(0);});
 it('does not release cash backing unrelated purchases after the original was paid',()=>{let b=add(allocate(base(),'ready','groceries',20000,'2026-01-01'),purchase);b=add(b,{id:'pay',kind:'payment',amount:10000,accountId:'cash',toAccountId:'card'});b=add(b,{...purchase,id:'other',date:'2026-01-04'});b=refund(b,10000,{date:'2026-01-05'});const t=conserve(b);expect(t.cards.card.owed).toBe(0);expect(t.cards.card.reserve).toBe(10000);expect(t.categories.groceries.cash).toBe(0);expect(t.categories.groceries.unfunded).toBe(0);});
 it('returns cash refunds to the original category instead of income',()=>{const b=refund(add(base(),{...purchase,accountId:'cash'}),10000,{accountId:'cash'});const t=conserve(b);expect(t.cash).toBe(100000);expect(t.categories.groceries.available).toBe(0);expect(t.income).toBe(0);});
 it('validates split refunds, cumulative limits, dates, accounts and deleted purchases',()=>{
  const b=add(base(),{...purchase,categoryId:undefined,splits:[{categoryId:'groceries',amount:6000},{categoryId:'dining',amount:4000}]});
  const valid=refund(b,6000);expect(()=>refund(b,6001)).toThrow(/exceed/);expect(()=>refund(valid,1,{id:'again'})).toThrow(/exceed/);
  expect(()=>refund(b,100,{date:'2026-01-01'})).toThrow(/follow/);expect(()=>refund(b,100,{accountId:'cash'})).toThrow(/same account/);
  expect(()=>validateBudget({...valid,entries:valid.entries.filter(e=>e.id!=='purchase')})).toThrow(/original/);
  const split=refund(b,10000,{categoryId:undefined,splits:[{categoryId:'groceries',amount:6000},{categoryId:'dining',amount:4000}]});expect(conserve(split).spent).toBe(0);
 });
 it('conserves cash through partial funding, payments and refunds',()=>{
  fc.assert(fc.property(fc.integer({min:0,max:10000}),fc.integer({min:0,max:10000}),fc.integer({min:1,max:10000}),(funding,payment,returned)=>{
   let b=base();if(funding)b=allocate(b,'ready','groceries',funding,'2026-01-01');b=add(b,purchase);if(payment)b=add(b,{id:'pay',kind:'payment',amount:payment,accountId:'cash',toAccountId:'card'});b=refund(b,returned,{date:'2026-01-04'});const t=conserve(b);expect(t.spent).toBe(10000-returned);expect(t.balances.card).toBe(-10000+payment+returned);expect(t.categories.groceries.unfunded).toBeGreaterThanOrEqual(0);
  }),{numRuns:200});
 });
});

describe('account reconciliation',()=>{
 it('excludes pending entries and keeps transfer clearing independent',()=>{const e:Entry={...purchase,id:'transfer',kind:'transfer',accountId:'cash',toAccountId:'savings',cleared:false,categoryId:undefined};let b=base();b.accounts.push({...b.accounts[0],id:'savings',opening:0});b=add(b,e);expect(clearedBalance(b,'cash','2026-01-31')).toBe(100000);const updated=setCleared(e,'cash',true);expect(isCleared(updated,'savings')).toBe(false);b={...b,entries:[updated]};expect(clearedBalance(b,'cash','2026-01-31')).toBe(90000);expect(clearedBalance(b,'savings','2026-01-31')).toBe(0);});
 it('records matching checkpoints and flags financial edits, deletion, or backdated entries',()=>{const b=reconcile(add(base(),{...purchase,accountId:'cash'}),'cash','2026-01-31',90000);const r=b.reconciliations![0];expect(reconciliationSignature(b,'cash',r.date)).toBe(r.signature);expect(validateBudget(JSON.parse(JSON.stringify(b))).reconciliations).toEqual(b.reconciliations);for(const entries of [[],b.entries.map(e=>({...e,amount:5000})),[...b.entries,{...purchase,id:'late',accountId:'cash'}]])expect(reconciliationSignature({...b,entries},'cash',r.date)).not.toBe(r.signature);expect(reconciliationSignature({...b,entries:b.entries.map(e=>({...e,note:'Memo correction'}))},'cash',r.date)).toBe(r.signature);});
 it('requires an explicit reason and excludes adjustments from income and spending',()=>{expect(()=>reconcile(base(),'cash','2026-01-31',95000)).toThrow(/reason/);const b=reconcile(base(),'cash','2026-01-31',95000,'Opening statement correction');const t=conserve(b);expect(t.cash).toBe(95000);expect(t.ready).toBe(95000);expect(t.spent).toBe(0);expect(t.income).toBe(0);expect(clearedBalance(b,'cash','2026-01-31')).toBe(95000);});
 it('adjusts card debt without cash creation and rejects future and invalid dates',()=>{const b=reconcile(base(),'card','2026-01-31',-5000,'Prior balance correction');const t=conserve(b);expect(t.cards.card.owed).toBe(5000);expect(t.cash).toBe(100000);expect(t.spent).toBe(0);expect(()=>reconcile(base(),'cash','2099-01-01',100000)).toThrow(/future/);expect(()=>reconcile(base(),'cash','2026-02-30',100000)).toThrow();});
});
