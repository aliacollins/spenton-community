import {describe,it,expect} from 'vitest';
import {blankBudget,calculate,validateBudget} from './engine';
import type {Budget,Entry,Schedule} from './engine';
import {assertScheduleCurrent,nextOccurrence,postOccurrence,updateSchedule} from './recurring';
const income:Entry={id:'salary-template',kind:'income',accountId:'cash',date:'2026-01-31',amount:10000,payee:'Salary',note:'',cleared:false};
const schedule:Schedule={id:'salary',frequency:'monthly',nextDate:'2026-02-28',template:income};
const base=():Budget=>validateBudget({...blankBudget(),accounts:[{id:'cash',name:'Cash',type:'checking',opening:50000,date:'2026-01-01',lastFour:''}],schedules:[schedule]});

describe('editing scheduled transactions',()=>{
 it('updates the next occurrence without posting income or moving its month-end anchor',()=>{
  const b=base(),before=structuredClone(b),s=b.schedules![0];
  const updated=updateSchedule(b,s,{...s.template,date:s.nextDate,amount:25000,payee:'Updated salary',note:'New amount'},'monthly');
  expect(b).toEqual(before);expect(updated.entries).toEqual(b.entries);expect(calculate(updated,'2026-02')).toEqual(calculate(b,'2026-02'));
  expect(updated.schedules![0]).toMatchObject({id:s.id,nextDate:'2026-02-28',template:{id:income.id,date:'2026-01-31',amount:25000,payee:'Updated salary',note:'New amount'}});
  expect(nextOccurrence(updated.schedules![0])).toBe('2026-03-31');
  const posted=postOccurrence(updated,s.id,'2026-02-28');expect(posted.entries[0]).toMatchObject({date:'2026-02-28',amount:25000,payee:'Updated salary',cleared:false});expect(posted.schedules![0].nextDate).toBe('2026-03-31');
 });
 it('starts repeat timing from an explicitly changed date',()=>{
  const b=base(),s=b.schedules![0];const updated=updateSchedule(b,s,{...s.template,date:'2026-03-15'},'monthly');
  expect(updated.schedules![0].template.date).toBe('2026-03-15');expect(nextOccurrence(updated.schedules![0])).toBe('2026-04-15');
 });
 it('can turn repeating entries into one-time entries and back without recording',()=>{
  const b=base(),s=b.schedules![0],once=updateSchedule(b,s,{...s.template,date:s.nextDate},'none');
  expect(once.entries).toHaveLength(0);expect(once.schedules![0].frequency).toBe('once');
  expect(postOccurrence(once,s.id,'2026-02-28').schedules).toHaveLength(0);
  const weekly=updateSchedule(once,once.schedules![0],{...income,date:s.nextDate},'weekly');expect(nextOccurrence(weekly.schedules![0])).toBe('2026-03-07');
 });
 it('reanchors when moving to an account opened after the original start',()=>{
  const b=base();b.accounts.push({id:'new',name:'New cash',type:'savings',opening:0,date:'2026-02-01',lastFour:''});const s=b.schedules![0];
  const updated=updateSchedule(b,s,{...s.template,date:s.nextDate,accountId:'new'},'monthly');expect(updated.schedules![0].template.date).toBe('2026-02-28');expect(nextOccurrence(updated.schedules![0])).toBe('2026-03-28');
  expect(()=>updateSchedule(b,s,{...s.template,date:'2026-01-31',accountId:'new'},'monthly')).toThrow(/predates/);
 });
 it('rejects stale edits and removed schedules while allowing unrelated budget changes',()=>{
  const b=base(),s=b.schedules![0],draft={...s.template,date:s.nextDate,payee:'My draft'};
  for(const schedules of [[],[{...s,nextDate:'2026-03-31'}],[{...s,template:{...s.template,amount:500}}]]){
   expect(()=>assertScheduleCurrent({...b,schedules},s)).toThrow(/changed or was removed/);
   expect(()=>updateSchedule({...b,schedules},s,draft,'monthly')).toThrow(/changed or was removed/);
  }
  expect(updateSchedule({...b,name:'Renamed budget'},s,draft,'monthly').name).toBe('Renamed budget');
 });
 it('rejects a date already recorded from this schedule',()=>{
  const posted=postOccurrence(base(),schedule.id,'2026-02-28'),s=posted.schedules![0];
  expect(()=>updateSchedule(posted,s,{...s.template,date:'2026-02-28'},'none')).toThrow(/already recorded/);expect(posted.entries).toHaveLength(1);
 });
 it('validates edited splits and resets occurrence metadata and clearing',()=>{
  const b=base(),s=b.schedules![0],draft:Entry={...income,date:s.nextDate,kind:'expense',amount:1000,cleared:true,clearedTo:true,importKey:'old-import',scheduleKey:'old-occurrence',splits:[{categoryId:'groceries',amount:600},{categoryId:'dining',amount:400}]};
  const result=updateSchedule(b,s,draft,'monthly');expect(result.schedules![0].template).toMatchObject({cleared:false,clearedTo:false,importKey:undefined,scheduleKey:undefined});expect(result.entries).toHaveLength(0);
  expect(()=>updateSchedule(b,s,{...draft,amount:2000},'monthly')).toThrow(/purchase total/);
 });
});
