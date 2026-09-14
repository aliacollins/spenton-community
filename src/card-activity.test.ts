import { describe,it,expect } from 'vitest';
import { allocate,blankBudget,calculate,validateBudget } from './engine';
import type { Entry } from './engine';
import { cardActivity } from './card-activity';

describe('spending, statement, and payment dates',()=>{
 it('a September purchase paid in October stays September spending and its reserve carries forward',()=>{
  let b=blankBudget('INR');
  const category=b.categories[0].id;
  b.accounts=[{id:'cash',name:'Bank',type:'checking',date:'2026-09-01',opening:2000000,lastFour:''},{id:'card',name:'Card',type:'credit',date:'2026-09-01',opening:0,lastFour:'',statement:{amount:1000000,minimum:50000,closed:'2026-10-16',due:'2026-10-31'}}];
  b=allocate(b,'ready',category,1000000,'2026-09-01');
  const purchase:Entry={id:'purchase',kind:'expense',accountId:'card',categoryId:category,date:'2026-09-20',amount:1000000,payee:'September shopping',note:'',cleared:true};
  b=validateBudget({...b,entries:[...b.entries,purchase]});
  const september=calculate(b,'2026-09');
  expect(september.spent).toBe(1000000);expect(september.cards.card.reserve).toBe(1000000);expect(september.cash).toBe(2000000);
  b=validateBudget({...b,entries:[...b.entries,{id:'payment',kind:'payment',accountId:'cash',toAccountId:'card',date:'2026-10-31',amount:1000000,payee:'Card payment',note:'',cleared:true}]});
  const october=calculate(b,'2026-10');
  expect(october.spent).toBe(0);expect(october.cards.card.statementRemaining).toBe(0);expect(october.cards.card.owed).toBe(0);expect(october.cards.card.reserve).toBe(0);expect(october.cash).toBe(1000000);
  expect(cardActivity(b,'card','2026-10').map(row=>[row.month,row.spending,row.payments])).toEqual([['2026-08',0,0],['2026-09',1000000,0],['2026-10',0,1000000]]);
 });
 it('keeps refunds in their recorded month and excludes another card, starting debt, and adjustments',()=>{
  const b=blankBudget();
  b.entries=[{id:'a',kind:'expense',accountId:'card',date:'2025-12-20',amount:10000},{id:'b',kind:'refund',accountId:'card',date:'2026-01-02',amount:2000},{id:'c',kind:'expense',accountId:'another',date:'2026-01-02',amount:9999},{id:'d',kind:'adjustment',accountId:'card',date:'2026-01-02',amount:7777},{id:'e',kind:'payment',accountId:'bank',toAccountId:'card',date:'2026-01-15',amount:8000}] as Entry[];
  expect(cardActivity(b,'card','2026-01').map(row=>[row.month,row.spending,row.payments])).toEqual([['2025-11',0,0],['2025-12',10000,0],['2026-01',-2000,8000]]);
 });
});
