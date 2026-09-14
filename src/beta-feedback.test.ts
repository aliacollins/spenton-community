import {describe,it,expect} from 'vitest';
import {allocate,blankBudget,calculate,validateBudget} from './engine';
import type {Budget,Entry} from './engine';
import {postOccurrence,saveTransaction,skipOccurrence} from './recurring';
import {resetBudget} from './budget-reset';
import {budgetsFromBackup} from './backup';
import {calendarDays,moveMonth,validDate} from './dates';

const base=():Budget=>({...blankBudget(),accounts:[{id:'cash',name:'Cash',type:'checking',opening:100000,date:'2026-01-01',lastFour:''}]});
const entry:Entry={id:'income',kind:'income',accountId:'cash',date:'2026-01-31',amount:12345,payee:'Salary',note:'',cleared:true};

describe('future entries',()=>{
 it.each(['income','expense','transfer','payment'] as const)('keeps a one-time future %s outside balances until explicitly recorded',kind=>{
  const b=base();b.accounts.push({id:'other',name:'Other',type:kind==='payment'?'credit':'savings',opening:0,date:'2026-01-01',lastFour:''});
  const e={...entry,kind,...(kind==='expense'?{categoryId:'groceries'}:{}),...(['transfer','payment'].includes(kind)?{toAccountId:'other'}:{})};
  const next=saveTransaction(b,e,'none',undefined,'2026-01-01');
  expect(next.entries).toHaveLength(0);expect(next.schedules?.[0].frequency).toBe('once');expect(calculate(next,'2026-02').balances.cash).toBe(100000);
  expect(()=>postOccurrence(next,next.schedules![0].id,'2026-01-30')).toThrow(/not due/);
  const posted=postOccurrence(next,next.schedules![0].id,'2026-01-31');expect(posted.schedules).toHaveLength(0);expect(posted.entries).toHaveLength(1);expect(posted.entries[0].cleared).toBe(false);
  expect(calculate(posted,'2026-01').balances.cash).toBe(100000+(kind==='income'?12345:-12345));
  const retried=postOccurrence({...posted,schedules:next.schedules},next.schedules![0].id,'2026-01-31');expect(retried.entries).toHaveLength(1);
 });
 it('records today once, schedules the next month, and respects turning repeat off',()=>{
  const next=saveTransaction(base(),entry,'monthly',undefined,'2026-01-31');expect(next.entries).toHaveLength(1);expect(next.schedules?.[0].nextDate).toBe('2026-02-28');
  expect(saveTransaction(base(),entry,'none',undefined,'2026-01-31').schedules??[]).toHaveLength(0);
  const future=saveTransaction(base(),entry,'none',undefined,'2026-01-01');expect(skipOccurrence(future,future.schedules![0].id).schedules).toHaveLength(0);
 });
 it('rejects a future edit of a recorded transaction',()=>expect(()=>saveTransaction({...base(),entries:[entry]},entry,'none',entry.id,'2026-01-01')).toThrow(/future/));
});

describe('budget reset and restoration',()=>{
 it('clears every money amount while keeping the requested structure and leaving the source untouched',()=>{
  const b=allocate(base(),'ready','groceries',10000,'2026-01-01');b.name='Personal budget';b.categories[0]={...b.categories[0],target:30000,targetType:'balance',targetDate:'2027-01-31'};b.categories.push({...b.categories[0],id:'child',parentId:b.categories[0].id,name:'Subcategory'});
  b.accounts.push({id:'card',name:'Visa',type:'credit',opening:-5000,date:'2026-01-01',lastFour:'',statement:{amount:5000,minimum:50,closed:'2026-01-01',due:'2026-02-01'}});
  const original=JSON.stringify(b),next=resetBudget(b,'structure');expect(JSON.stringify(b)).toBe(original);expect(next.name).toBe(b.name);expect(next.categories.map(c=>[c.id,c.name,c.parentId])).toEqual(b.categories.map(c=>[c.id,c.name,c.parentId]));expect(next.accounts.map(a=>a.name)).toEqual(['Cash','Visa']);expect(next.categories.every(c=>c.target===0&&!c.targetDate)).toBe(true);expect(next.accounts.every(a=>a.opening===0&&!a.statement)).toBe(true);expect(next.entries).toHaveLength(0);expect(calculate(next,'2099-01').netWorth).toBe(0);
  expect(resetBudget(b,'factory')).toEqual(blankBudget(b.currency));
 });
 it('imports only reviewed budget content from single-budget and whole-account backups',()=>{
  const b=base(),archive={format:'spenton-account-export',version:1,profile:{id:'old-owner',isAdmin:true},sessions:[{id:'old-session'}],budgets:[{id:'old-id',budget:b},{budget:{...b,name:'Second'}}]};
  expect(budgetsFromBackup(b)).toEqual([b]);expect(budgetsFromBackup(archive)).toEqual([b,{...b,name:'Second'}]);expect(budgetsFromBackup(archive)[0]).not.toHaveProperty('profile');expect(()=>budgetsFromBackup({...archive,version:99})).toThrow(/supported/);expect(()=>budgetsFromBackup({...archive,budgets:[{budget:{...b,currency:'SQL'}}]})).toThrow();
 });
});

describe('bounded, typed financial data',()=>{
 it.each(['__proto__','constructor','prototype',"cash'; DROP TABLE users;--",'x'.repeat(161)])('rejects dangerous or oversized internal IDs: %s',id=>expect(()=>validateBudget({...base(),accounts:[{...base().accounts[0],id}]})).toThrow());
 it.each(['123; DROP TABLE budgets',123.45,NaN,Infinity,1e15])('rejects noninteger or oversized amounts: %s',amount=>expect(()=>validateBudget({...base(),entries:[{...entry,amount}]})).toThrow());
 it.each(['   ','<script>alert(1)</script>','name\u0000','x'.repeat(81)])('rejects invalid account names: %s',name=>expect(()=>validateBudget({...base(),accounts:[{...base().accounts[0],name}]})).toThrow());
 it('keeps apostrophes and SQL-looking prose as data and constrains appearance fields',()=>{
  const b=validateBudget({...base(),entries:[{...entry,payee:"O'Brien's shop",note:"SELECT budget FROM my notes; <script>not executable</script>"}]});expect(b.entries[0].note).toContain('SELECT');
  for(const edit of [{icon:'script'},{color:'sage onclick=alert(1)'},{note:'\u0000'}])expect(()=>validateBudget('note' in edit?{...base(),entries:[{...entry,...edit}]}:{...base(),categories:[{...base().categories[0],...edit}]})).toThrow();
 });
});

it('calendar navigation handles leap days and year changes without changing the chosen date',()=>{
 const selected='2026-09-09';expect(moveMonth(selected,4)).toBe('2027-01');expect(selected).toBe('2026-09-09');expect(calendarDays('2024-02')).toContain('2024-02-29');expect(validDate('2026-02-29')).toBe(false);expect(validDate('2024-02-29')).toBe(true);
});
