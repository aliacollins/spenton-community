import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { allocate, blankBudget, calculate, cents, demoBudget, id, validateBudget } from './engine';
import type { Budget, Entry } from './engine';
const month='2026-09';
function base():Budget{return {...blankBudget(),accounts:[{id:'cash',name:'Cash',type:'checking',opening:1000000,date:'2026-09-01',lastFour:''},{id:'card',name:'Card',type:'credit',opening:0,date:'2026-09-01',lastFour:'',statement:{amount:25000,minimum:1000,closed:'2026-09-05',due:'2026-09-20'}}],categories:[{id:'food',name:'Food',group:'Essentials',icon:'basket',color:'sage',target:100000,targetType:'monthly'},{id:'other',name:'Other',group:'Essentials',icon:'wallet',color:'sage',target:0,targetType:'monthly'}]};}
function add(b:Budget,kind:Entry['kind'],amount:number,extra:Partial<Entry>={}):Budget{return validateBudget({...b,entries:[...b.entries,{id:id(),kind,amount,date:'2026-09-09',payee:'Test',note:'',cleared:true,...extra}]});}
function conservation(b:Budget,m=month){const t=calculate(b,m);expect(t.cash).toBe(t.unassignedBeforeShortfalls+Object.values(t.categories).reduce((n,c)=>n+c.cash,0)+Object.values(t.cards).reduce((n,c)=>n+c.reserve,0));expect(t.cash).toBe(t.ready+Object.values(t.categories).reduce((n,c)=>n+Math.max(0,c.cash),0)+Object.values(t.cards).reduce((n,c)=>n+Math.max(0,c.reserve),0));}
describe('integer money',()=>{
 it('parses amounts exactly and rejects hidden precision',()=>{expect(cents('1,234.56')).toBe(123456);expect(cents('0.29')).toBe(29);expect(cents('-0.01')).toBe(-1);expect(()=>cents('1.001')).toThrow();expect(()=>cents('1e5')).toThrow();expect(()=>cents('NaN')).toThrow();});
});
describe('subcategory validation and accounting',()=>{
 it('keeps child amounts separate and preserves the cash identity',()=>{
  let b=base();b.categories.push({...b.categories[0],id:'produce',name:'Produce',parentId:'food'});
  b=allocate(b,'ready','food',10000,'2026-09-01');b=allocate(b,'ready','produce',5000,'2026-09-01');
  b=add(b,'expense',2000,{accountId:'card',categoryId:'produce'});
  const t=calculate(b,month);expect(t.categories.food.available).toBe(10000);expect(t.categories.produce.available).toBe(3000);expect(t.spent).toBe(2000);expect(t.cards.card.reserve).toBe(2000);conservation(b);
  expect(validateBudget(JSON.parse(JSON.stringify(b))).categories.at(-1)?.parentId).toBe('food');
 });
 it('rejects missing parents, cycles and children in another group',()=>{
  const b=base();b.categories[1].parentId='missing';expect(()=>validateBudget(b)).toThrow(/subcategory/);
  b.categories[1].parentId='food';b.categories[0].parentId='other';expect(()=>validateBudget(b)).toThrow(/subcategory/);
  delete b.categories[0].parentId;b.categories[1].group='Different';expect(()=>validateBudget(b)).toThrow(/subcategory/);
 });
});
describe('credit cards and actual cash',()=>{
 it('reserves funded purchases and pays a statement without counting spending twice',()=>{
  let b=allocate(base(),'ready','food',100000,'2026-09-01');b=allocate(b,'ready','other',900000,'2026-09-01');
  b=add(b,'expense',25000,{date:'2026-09-03',accountId:'card',categoryId:'food'});
  b=add(b,'expense',15000,{date:'2026-09-08',accountId:'card',categoryId:'food'});
  b=add(b,'payment',25000,{accountId:'cash',toAccountId:'card'});
  const t=calculate(b,month);expect(t.cash).toBe(975000);expect(t.categories.food.available).toBe(60000);expect(t.cards.card.reserve).toBe(15000);expect(t.cards.card.owed).toBe(15000);expect(t.cards.card.statementRemaining).toBe(0);expect(t.spent).toBe(40000);conservation(b);
 });
 it('records unfunded spending without inventing cash, and funds it later',()=>{
  let b=allocate(base(),'ready','food',5000,'2026-09-01');b=add(b,'expense',12000,{accountId:'card',categoryId:'food'});
  let t=calculate(b,month);expect(t.cards.card.reserve).toBe(5000);expect(t.categories.food.available).toBe(-7000);expect(t.cards.card.unbacked).toBe(7000);conservation(b);
  b=allocate(b,'ready','food',7000,'2026-09-10');t=calculate(b,month);expect(t.categories.food.available).toBe(0);expect(t.cards.card.reserve).toBe(12000);expect(t.spent).toBe(12000);conservation(b);
 });
 it('funding a card directly also backs its outstanding purchases',()=>{
  let b=add(base(),'expense',12000,{accountId:'card',categoryId:'food'});b=allocate(b,'ready','card:card',12000,'2026-09-10');
  expect(calculate(b,month).categories.food.unfunded).toBe(0);conservation(b);
 });
 it('shows a funding shortfall for a real payment without a reserve',()=>{
  let b=add(base(),'expense',10000,{accountId:'card',categoryId:'food'});b=add(b,'payment',10000,{accountId:'cash',toAccountId:'card'});
  const t=calculate(b,month);expect(t.cards.card.owed).toBe(0);expect(t.cards.card.reserve).toBe(-10000);expect(t.categories.food.unfunded).toBe(0);expect(t.cash).toBe(990000);conservation(b);
  b=allocate(b,'ready','card:card',10000,'2026-09-10');expect(calculate(b,month).cards.card.reserve).toBe(0);conservation(b);
 });
 it('preserves issuer credit after overpayment and uses it before reserving cash',()=>{
  let b=base();b=allocate(b,'ready','food',10000,'2026-09-01');b=allocate(b,'ready','card:card',5000,'2026-09-01');b=add(b,'payment',5000,{accountId:'cash',toAccountId:'card'});
  expect(calculate(b,month).cards.card.credit).toBe(5000);
  b=add(b,'expense',8000,{accountId:'card',categoryId:'food'});const t=calculate(b,month);
  expect(t.cards.card.owed).toBe(3000);expect(t.cards.card.reserve).toBe(3000);expect(t.categories.food.available).toBe(7000);expect(t.cash).toBe(995000);conservation(b);
 });
 it('does not confuse opening debt with current spending or cash',()=>{
  const b=base();b.accounts[1].opening=-50000;const t=calculate(b,month);expect(t.spent).toBe(0);expect(t.ready).toBe(1000000);expect(t.netWorth).toBe(950000);expect(t.cards.card.owed).toBe(50000);conservation(b);
 });
 it('uses payment cash once when old debt and new purchases coexist',()=>{
  let b=base();b.accounts[1].opening=-10000;b=allocate(b,'ready','food',10000,'2026-09-01');b=add(b,'expense',10000,{accountId:'card',categoryId:'food'});b=add(b,'payment',10000,{accountId:'cash',toAccountId:'card'});
  const t=calculate(b,month);expect(t.cards.card.owed).toBe(10000);expect(t.cards.card.reserve).toBe(0);expect(t.categories.food.unfunded).toBe(10000);conservation(b);
 });
 it('carries balances forward without creating money or repeating spending',()=>{
  let b=allocate(base(),'ready','food',50000,'2026-09-01');b=add(b,'expense',12000,{accountId:'card',categoryId:'food'});
  const sept=calculate(b,month),oct=calculate(b,'2026-10');expect(oct.cash).toBe(sept.cash);expect(oct.ready).toBe(sept.ready);expect(oct.cards.card.reserve).toBe(sept.cards.card.reserve);expect(oct.categories.food.available).toBe(sept.categories.food.available);expect(oct.categories.food.carry).toBe(38000);expect(oct.spent).toBe(0);expect(oct.categories.food.assigned).toBe(0);conservation(b,'2026-10');
 });
 it('recalculates a backdated cash purchase and keeps any resulting shortfall visible',()=>{
  let b=allocate(base(),'ready','food',10000,'2026-09-01');b=add(b,'expense',8000,{date:'2026-09-08',accountId:'card',categoryId:'food'});b=add(b,'expense',6000,{date:'2026-09-03',accountId:'cash',categoryId:'food'});
  const t=calculate(b,month);expect(t.categories.food.unfunded).toBe(4000);expect(t.cards.card.reserve).toBe(4000);expect(t.spent).toBe(14000);conservation(b);
 });
});
describe('ledger invariants',()=>{
 it('conserves cash across random purchase, funding and payment sequences',()=>{
  fc.assert(fc.property(fc.array(fc.record({kind:fc.integer({min:0,max:4}),amount:fc.integer({min:1,max:100000})}),{maxLength:70}),events=>{
   let b=base();
   for(const e of events){
    const t=calculate(b,month);
    if(e.kind===0&&t.ready>=e.amount)b=allocate(b,'ready','food',e.amount,'2026-09-09');
    if(e.kind===1)b=add(b,'expense',e.amount,{accountId:'card',categoryId:'food'});
    if(e.kind===2)b=add(b,'expense',e.amount,{accountId:'cash',categoryId:'food'});
    if(e.kind===3)b=add(b,'payment',e.amount,{accountId:'cash',toAccountId:'card'});
    if(e.kind===4)b=add(b,'income',e.amount,{accountId:'cash'});
    conservation(b);
    const next=calculate(b,month);expect(next.cards.card.reserve).toBeLessThanOrEqual(next.cash+Math.max(0,-next.categories.food.cash));
   }
  }),{numRuns:100});
 });
 it('preserves the entire sample through export and restore',()=>{
  const b=demoBudget();const restored=validateBudget(JSON.parse(JSON.stringify(b)));expect(restored).toEqual(b);const m=b.accounts[0].date.slice(0,7);expect(calculate(restored,m)).toEqual(calculate(b,m));conservation(restored,m);
 });
 it('rejects an allocation without an available source',()=>{expect(()=>allocate(base(),'ready','food',1000001,'2026-09-01')).toThrow(/not enough/);expect(()=>allocate(base(),'ready','ready',100,'2026-09-01')).toThrow();});
 it('rejects invalid references, duplicate IDs, dates and unsupported income',()=>{
  const b=base();expect(()=>add(b,'expense',100,{accountId:'cash',categoryId:'missing'})).toThrow();expect(()=>add(b,'income',100,{accountId:'card'})).toThrow();expect(()=>add(b,'income',100,{accountId:'cash',date:'2026-02-30'})).toThrow();
  b.accounts.push({...b.accounts[0]});expect(()=>validateBudget(b)).toThrow(/duplicate/);
 });
 it('cash transfers leave the budget and spending unchanged',()=>{
  let b=base();b.accounts.push({id:'savings',name:'Savings',type:'savings',opening:50000,date:'2026-09-01',lastFour:''});b=add(b,'transfer',25000,{accountId:'cash',toAccountId:'savings'});
  const t=calculate(b,month);expect(t.balances.savings).toBe(75000);expect(t.cash).toBe(1050000);expect(t.spent).toBe(0);expect(t.ready).toBe(1050000);conservation(b);
 });
});

describe('everyday amount entry',()=>{
 it('accepts displayed currency amounts, Indian grouping and natural decimal typing exactly',()=>{
  for(const [input,expected] of [['₹1,250.50',125050],['₹1,23,456.78',12345678],['£25.10',2510],['€0.29',29],['$1,000.',100000],['.50',50],['-.50',-50],['+12.5',1250],['12.',1200],[' 42 ',4200]] as const)expect(cents(input)).toBe(expected);
 });
 it('rejects ambiguous grouping, hidden precision and nonnumeric pasted values',()=>{
  for(const input of ['1,2','12,34','1 2','1.234','1e3','₹$20','','.','-','NaN','Infinity','12.50oops','10000000000.01'])expect(()=>cents(input)).toThrow();
 });
});
