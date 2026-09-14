import { describe,expect,it } from 'vitest';
import { allocate,blankBudget,calculate,targetNeed,validateBudget } from './engine';
import type { Category,CategoryTotal } from './engine';
import { parseTargetFields,targetProgress,targetSummary,goalDateAfterMonths } from './targets';

const category=(change:Partial<Category>={}):Category=>({id:'goal',name:'Repairs',group:'Home',icon:'home',color:'sage',target:20000,targetType:'capped',targetCap:150000,...change});
const totals=(change:Partial<CategoryTotal>={}):CategoryTotal=>({cash:0,available:0,unfunded:0,assigned:0,spent:0,carry:0,...change});
const form=(values:Record<string,string>)=>{const f=new FormData();for(const [key,value]of Object.entries(values))f.set(key,value);return f;};

describe('flexible targets',()=>{
 it('limits a monthly contribution to the remaining balance gap',()=>{
  expect(targetNeed(category(),totals({available:145000}),'2026-09')).toBe(5000);
  expect(targetNeed(category(),totals({available:150000}),'2026-09')).toBe(0);
  expect(targetNeed(category(),totals({available:160000}),'2026-09')).toBe(0);
 });
 it('counts partial contributions and does not reset after spending in the same month',()=>{
  expect(targetNeed(category(),totals({available:130000,assigned:5000}),'2026-09')).toBe(15000);
  expect(targetNeed(category(),totals({available:100000,assigned:20000,spent:30000}),'2026-09')).toBe(0);
  expect(targetNeed(category(),totals({available:100000,assigned:0}),'2026-10')).toBe(20000);
 });
 it('resumes after spending next month using the real allocation ledger',()=>{
  let b=validateBudget({...blankBudget(),accounts:[{id:'bank',name:'Bank',type:'checking',opening:300000,date:'2026-01-01'}],categories:[category()]});
  b=allocate(b,'ready','goal',150000,'2026-08-01');
  expect(targetNeed(b.categories[0],calculate(b,'2026-08').categories.goal,'2026-08')).toBe(0);
  b=validateBudget({...b,entries:[...b.entries,{id:'repair',kind:'expense',accountId:'bank',categoryId:'goal',date:'2026-09-04',amount:40000,payee:'Repair',note:'',cleared:true}]});
  expect(targetNeed(b.categories[0],calculate(b,'2026-09').categories.goal,'2026-09')).toBe(20000);
  b=allocate(b,'ready','goal',8000,'2026-09-05');
  expect(targetNeed(b.categories[0],calculate(b,'2026-09').categories.goal,'2026-09')).toBe(12000);
 });
 it('pauses only explicit months across the year boundary',()=>{
  const c=category({targetPausedMonths:['2026-12','2027-02']});
  expect(targetNeed(c,totals(),'2026-12')).toBe(0);
  expect(targetNeed(c,totals(),'2027-01')).toBe(20000);
  expect(targetNeed(c,totals(),'2027-02')).toBe(0);
  expect(targetNeed(c,totals(),'2027-12')).toBe(20000);
 });
 it('paces dated goals and gives partial assignments full credit',()=>{
  const c=category({target:10000,targetType:'balance',targetCap:undefined,targetDate:'2027-02-15'});
  expect(targetNeed(c,totals(),'2026-12')).toBe(3334);
  expect(targetNeed(c,totals({available:1000,assigned:1000}),'2026-12')).toBe(2334);
  expect(targetNeed(c,totals({available:3334}),'2027-01')).toBe(3333);
  expect(targetNeed(c,totals({available:6667}),'2027-02')).toBe(3333);
  expect(targetNeed(c,totals({available:6667}),'2027-03')).toBe(3333);
  expect(targetNeed({...c,targetPausedMonths:['2027-01']},totals(),'2026-12')).toBe(5000);
 });
 it('never asks to fund a disabled target or a negative amount',()=>{
  expect(targetNeed(category({target:0}),totals({available:-500,assigned:-500}),'2026-09')).toBe(0);
  expect(targetNeed(category({targetType:'balance',targetDate:'2027-01-01'}),totals({available:50000,assigned:30000}),'2026-09')).toBe(0);
 });
 it('retains old backup targets and validates optional settings',()=>{
  expect(validateBudget(blankBudget()).categories[0].targetType).toBe('monthly');
  const b={...blankBudget(),categories:[category()]};
  expect(validateBudget(b).categories[0].targetCap).toBe(150000);
  expect(()=>validateBudget({...b,categories:[category({targetCap:undefined})]})).toThrow();
  expect(()=>validateBudget({...b,categories:[category({targetPausedMonths:['2026-13']})]})).toThrow();
  expect(()=>validateBudget({...b,categories:[category({target:-1})]})).toThrow();
 });
 it('preserves other paused months when saving or resuming a target',()=>{
  const c=category({targetPausedMonths:['2026-12','2027-02']});
  const fields={target:'200',targetType:'capped',targetCap:'1500',targetMonth:'2027-01',targetPaused:'on'};
  expect(parseTargetFields(form(fields),c).targetPausedMonths).toEqual(['2026-12','2027-01','2027-02']);
  expect(parseTargetFields(form({...fields,targetMonth:'2026-12',targetPaused:''}),c).targetPausedMonths).toEqual(['2027-02']);
  expect(parseTargetFields(form({...fields,targetType:'monthly'}),c).targetCap).toBeUndefined();
  expect(()=>parseTargetFields(form({...fields,target:'-2'}),c)).toThrow('negative');
 });
 it('uses plain target summaries and balance progress for capped goals',()=>{
  expect(targetSummary(category(),'USD','2026-09')).toBe('$200.00 each month, up to $1,500.00');
  expect(targetSummary(category({targetPausedMonths:['2026-09']}),'USD','2026-09')).toBe('Goal paused for this month');
  expect(targetProgress(category(),totals({available:75000}),'2026-09')).toBe(50);
  expect(targetProgress(category({targetType:'monthly',targetPausedMonths:['2026-09']}),totals({assigned:5000}),'2026-09')).toBe(25);
 });
});


it('turns a duration into inclusive calendar contributions across years and leap dates',()=>{
 expect(goalDateAfterMonths('2026-09','12')).toBe('2027-08-31');
 expect(goalDateAfterMonths('2028-01','2')).toBe('2028-02-29');
 expect(goalDateAfterMonths('2026-09','1')).toBe('2026-09-30');
 for(const invalid of ['0','-1','1.5','601',''])expect(goalDateAfterMonths('2026-09',invalid)).toBe('');
});
it('reaches a 5000 goal in 12 contributions without rounding past the goal',()=>{
 const goal=category({target:500000,targetType:'balance',targetDate:'2027-08-31'});
 expect(targetNeed(goal,totals(),'2026-09')).toBe(41667);
 expect(targetNeed(goal,totals({available:20000,assigned:20000}),'2026-09')).toBe(21667);
 expect(targetNeed(goal,totals({available:100000}),'2026-09')).toBe(33334);
 let saved=0;
 for(let index=0;index<12;index++){const date=goalDateAfterMonths('2026-09',String(index+1));saved+=targetNeed(goal,totals({available:saved}),date.slice(0,7));}
 expect(saved).toBe(500000);
});
