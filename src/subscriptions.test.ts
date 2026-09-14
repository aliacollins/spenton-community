import {describe,expect,it} from 'vitest';
import {blankBudget,calculate,validateBudget} from './engine';
import type {Budget,Entry,Schedule} from './engine';
import {addSubscription,applySubscriptionFlags,canTrackSubscription,retainedSubscriptionFlags,subscriptionCosts,trackedSubscriptions,trackSubscriptions} from './subscriptions';
import {postOccurrence,updateSchedule} from './recurring';

const entry:Entry={id:'payment',kind:'expense',accountId:'cash',categoryId:'groceries',date:'2026-01-31',amount:1499,payee:'Fictional streaming',note:'',cleared:false};
const base=():Budget=>({...blankBudget(),accounts:[{id:'cash',name:'Cash',type:'checking',opening:100000,date:'2026-01-01',lastFour:''}]});
const schedule=(frequency:Schedule['frequency'],amount:number,subscription=true):Schedule=>({id:frequency,frequency,subscription,nextDate:'2026-01-31',template:{...entry,amount}});

describe('subscriptions use recorded schedules without creating spending',()=>{
 it('adds a due subscription without changing cash, spending or category balances',()=>{
  const budget=base(),before=structuredClone(budget),next=addSubscription(budget,entry,'monthly');
  expect(next.entries).toEqual([]);expect(next.schedules).toHaveLength(1);
  expect(calculate(next,'2026-01')).toEqual(calculate(budget,'2026-01'));expect(budget).toEqual(before);
  expect(next.schedules?.[0]).toMatchObject({subscription:true,nextDate:'2026-01-31',frequency:'monthly',template:{cleared:false}});
 });
 it('records once, retains tracking and keeps the month-end anchor',()=>{
  const budget=addSubscription(base(),entry,'monthly'),original=budget.schedules![0];
  const posted=postOccurrence(budget,original.id,'2026-01-31');
  expect(posted.schedules![0]).toMatchObject({subscription:true,nextDate:'2026-02-28'});
  const retry=postOccurrence({...posted,schedules:[original]},original.id,'2026-01-31');
  expect(retry.entries).toHaveLength(1);expect(calculate(retry,'2026-01').spent).toBe(1499);
  expect(postOccurrence(posted,original.id,'2026-02-28').schedules![0].nextDate).toBe('2026-03-31');
 });
 it('marks existing split expenses and stops tracking without changing the schedule or ledger',()=>{
  const scheduled={...schedule('monthly',3000,false),template:{...entry,categoryId:undefined,amount:3000,splits:[{categoryId:'groceries',amount:1000},{categoryId:'dining',amount:2000}]}};
  const budget={...base(),schedules:[scheduled]},marked=trackSubscriptions(budget,[scheduled]);
  expect(trackedSubscriptions(marked)).toHaveLength(1);expect(marked.entries).toEqual(budget.entries);
  expect(marked.schedules![0].template).toEqual(validateBudget(budget).schedules![0].template);
  const stopped=trackSubscriptions(marked,[marked.schedules![0]],false);
  expect(trackedSubscriptions(stopped)).toEqual([]);expect(stopped.schedules).toHaveLength(1);
 });
 it('rejects stale, one-time and income schedules rather than guessing subscriptions',()=>{
  const original=schedule('monthly',1499,false),budget={...base(),schedules:[original]};
  expect(()=>trackSubscriptions({...budget,schedules:[{...original,nextDate:'2026-02-28'}]},[original])).toThrow(/changed/);
  expect(canTrackSubscription(schedule('once',1000,false))).toBe(false);
  expect(()=>validateBudget({...base(),schedules:[schedule('once',1000)]})).toThrow(/repeating expense/);
  expect(()=>validateBudget({...base(),schedules:[{...schedule('monthly',1000),template:{...entry,kind:'income'}}]})).toThrow(/repeating expense/);
 });
 it('keeps tracking when editing a payment and clears it when changing to a one-time entry',()=>{
  const original=schedule('monthly',1499),budget={...base(),schedules:[original]};
  expect(updateSchedule(budget,original,{...entry,amount:1999},'monthly').schedules![0].subscription).toBe(true);
  expect(updateSchedule(budget,original,entry,'none').schedules![0].subscription).toBe(false);
 });
 it('rounds mixed weekly, monthly and annual estimates once in minor units',()=>{
  expect(subscriptionCosts([schedule('weekly',1000),schedule('monthly',1500),schedule('yearly',12000),schedule('monthly',90000,false)]))
   .toEqual({annual:82000,monthly:6833});
  expect(subscriptionCosts([schedule('yearly',1),schedule('yearly',5)])).toEqual({annual:6,monthly:1});
  expect(subscriptionCosts([])).toEqual({annual:0,monthly:0});
 });
 it('reports out-of-range aggregates without imprecise money',()=>{
  expect(subscriptionCosts([schedule('weekly',Number.MAX_SAFE_INTEGER)])).toEqual({annual:null,monthly:null});
 });
 it('preserves omitted tracking for older clients but respects explicit changes and deleted schedules',()=>{
  const saved={...base(),schedules:[schedule('monthly',1499)]};
  const {subscription:_,...oldSchedule}=saved.schedules[0],submitted={...saved,schedules:[oldSchedule]};
  const flags=retainedSubscriptionFlags(saved,submitted);
  expect(applySubscriptionFlags(submitted,flags).schedules![0].subscription).toBe(true);
  expect(retainedSubscriptionFlags(saved,{...submitted,schedules:[{...oldSchedule,subscription:false}]})).toEqual([]);
  expect(retainedSubscriptionFlags(saved,{...submitted,schedules:[]})).toEqual([]);
  expect(retainedSubscriptionFlags(saved,{...submitted,schedules:[{...oldSchedule,frequency:'once'}]})).toEqual([]);
 });
});
