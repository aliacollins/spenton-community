import { describe,expect,it } from 'vitest';
import { blankBudget } from './engine';
import type { Budget,Entry } from './engine';
import { categoryHistory,explainCategoryMonth } from './budget-history';

function fixture(entries:Entry[]=[]):Budget{
 const budget=blankBudget();
 budget.accounts=[{id:'cash',name:'Current account',type:'checking',opening:100000,date:'2024-01-01',lastFour:''},{id:'card',name:'Travel Visa',type:'credit',opening:0,date:'2024-01-01',lastFour:''},{id:'other-card',name:'Other card',type:'credit',opening:0,date:'2024-01-01',lastFour:''}];
 budget.categories=[{id:'holiday',name:'Holiday',group:'Goals',icon:'plane',target:0,targetType:'balance',color:'blue'},{id:'food',name:'Food',group:'Everyday',icon:'basket',target:0,targetType:'monthly',color:'sage'}];
 budget.entries=entries;return budget;
}
const movement=(id:string,date:string,from:string,to:string,amount:number):Entry=>({id,date,from,to,amount,kind:'allocation',payee:'Money moved',note:'',cleared:true});
const purchase=(id:string,date:string,amount:number,accountId='cash',categoryId='holiday'):Entry=>({id,date,amount,accountId,categoryId,kind:'expense',payee:'Travel booking',note:'',cleared:true});

describe('category movement history',()=>{
 it('traces allocation sources and destinations and separates carryover from current activity',()=>{
  const budget=fixture([
   movement('jan','2024-01-15','ready','holiday',10000),
   movement('feb-in','2024-02-02','ready','holiday',5000),
   movement('feb-out','2024-02-03','holiday','food',2000),
   purchase('booking','2024-02-04',3000),
   {...purchase('refund','2024-02-05',1000),kind:'refund',refundOf:'booking'},
   movement('march','2024-03-01','ready','holiday',10000),
  ]);
  const history=categoryHistory(budget,'holiday','2024-02');
  expect(history.rows.map(row=>row.entry.id)).toEqual(['refund','booking','feb-out','feb-in']);
  expect(history.rows[2]).toMatchObject({from:'Holiday',to:'Food',assignmentDelta:-2000,spendingDelta:0});
  expect(history.rows[3]).toMatchObject({from:'Available to plan',to:'Holiday',assignmentDelta:5000});
  expect(explainCategoryMonth(budget,'holiday','2024-02')).toMatchObject({carry:10000,assigned:3000,assignedIn:5000,assignedOut:2000,purchases:3000,refunds:1000,spent:2000,cash:11000,available:11000});
  expect(categoryHistory(budget,'holiday','2024-02',true).rows.map(row=>row.entry.id)).toEqual(['refund','booking','feb-out','feb-in','jan']);
 });
 it('shows only a category’s share of split purchases and refunds',()=>{
  const budget=fixture([
   movement('fund','2024-02-01','ready','holiday',10000),
   {...purchase('split','2024-02-02',9000),categoryId:undefined,splits:[{categoryId:'holiday',amount:2000},{categoryId:'food',amount:7000}]},
   {...purchase('return','2024-02-03',3000),kind:'refund',refundOf:'split',categoryId:undefined,splits:[{categoryId:'holiday',amount:1000},{categoryId:'food',amount:2000}]},
   purchase('food-only','2024-02-04',250,'cash','food'),
  ]);
  const {rows}=categoryHistory(budget,'holiday','2024-02');
  expect(rows).toHaveLength(3);
  expect(rows[0]).toMatchObject({amount:1000,spendingDelta:-1000,split:true,entry:{amount:3000}});
  expect(rows[1]).toMatchObject({amount:2000,spendingDelta:2000,split:true,entry:{amount:9000}});
  expect(explainCategoryMonth(budget,'holiday','2024-02')).toMatchObject({purchases:2000,refunds:1000,spent:1000});
 });
 it('keeps shared card funding and payments separate from category assignments and spending',()=>{
  const budget=fixture([
   purchase('card-buy','2024-02-01',5000,'card'),
   movement('reserve','2024-02-02','ready','card:card',2000),
   {id:'payment',kind:'payment',date:'2024-02-03',accountId:'cash',toAccountId:'card',amount:2000,payee:'Card payment',note:'',cleared:true},
   movement('unrelated','2024-02-04','ready','card:other-card',2000),
  ]);
  const history=categoryHistory(budget,'holiday','2024-02');
  expect(history.rows.map(row=>row.entry.id)).toEqual(['card-buy']);
  expect(history.cardContext.map(row=>row.entry.id)).toEqual(['payment','reserve']);
  expect(history.cardContext[1]).toMatchObject({from:'Available to plan',to:'Travel Visa cash set aside',scope:'card',assignmentDelta:0,spendingDelta:0});
  expect(explainCategoryMonth(budget,'holiday','2024-02')).toMatchObject({assigned:0,assignedIn:0,assignedOut:0,purchases:5000,cash:0,unfunded:3000,available:-3000});
 });
 it('does not duplicate a category-to-card allocation in card context',()=>{
  const budget=fixture([purchase('card-buy','2024-02-01',5000,'card'),movement('direct','2024-02-02','holiday','card:card',1000)]);
  const history=categoryHistory(budget,'holiday','2024-02');
  expect(history.rows[0]).toMatchObject({entry:{id:'direct'},assignmentDelta:-1000,to:'Travel Visa cash set aside'});
  expect(history.cardContext).toHaveLength(0);
 });
 it('preserves reverse source order for entries recorded on the same day',()=>{
  const budget=fixture([movement('first','2024-02-01','ready','holiday',100),movement('second','2024-02-01','holiday','food',50)]);
  expect(categoryHistory(budget,'holiday','2024-02').rows.map(row=>row.entry.id)).toEqual(['second','first']);
 });
 it('validates the selected category and month',()=>{
  expect(()=>categoryHistory(fixture(),'missing','2024-02')).toThrow(/existing category/);
  expect(()=>categoryHistory(fixture(),'holiday','2024-13')).toThrow(/valid month/);
 });
});

describe('card activity is not a cash delta',()=>{
 it('shows issuer-credit purchases as spending without claiming category cash moved',()=>{
  const budget=fixture([movement('fund','2024-02-01','ready','holiday',10000),purchase('credit-buy','2024-02-02',3000,'card')]);
  budget.accounts[1].opening=5000;
  const total=explainCategoryMonth(budget,'holiday','2024-02');
  expect(total).toMatchObject({assigned:10000,purchases:3000,spent:3000,cash:10000,available:10000});
  expect(total.available).not.toBe(total.carry+total.assigned-total.spent);
  expect(categoryHistory(budget,'holiday','2024-02').rows[0]).toMatchObject({isCard:true,spendingDelta:3000,assignmentDelta:0});
 });
 it('shows a refund after repayment without inventing returned category cash',()=>{
  const budget=fixture([
   movement('fund','2024-02-01','ready','holiday',5000),
   purchase('card-buy','2024-02-02',5000,'card'),
   {id:'payment',kind:'payment',date:'2024-02-03',accountId:'cash',toAccountId:'card',amount:5000,payee:'Card payment',note:'',cleared:true},
   {...purchase('late-refund','2024-02-04',3000,'card'),kind:'refund',refundOf:'card-buy'},
  ]);
  expect(explainCategoryMonth(budget,'holiday','2024-02')).toMatchObject({purchases:5000,refunds:3000,spent:2000,cash:0,unfunded:0,available:0});
  expect(categoryHistory(budget,'holiday','2024-02').rows[0]).toMatchObject({amount:3000,isCard:true,spendingDelta:-3000,assignmentDelta:0});
 });
});
