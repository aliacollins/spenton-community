import {describe,it,expect} from 'vitest';
import fc from 'fast-check';
import {planGroupBill,billOccurrence} from './group-bill-plan';
describe('group bill allocation',()=>{
 it('keeps one bill’s multiple real payers and consumer shares separate',()=>{
  const plan=planGroupBill({total:100000,method:'percent',people:[{memberId:'maya',value:'50'},{memberId:'megan',value:'50'}],payers:[{memberId:'maya',amount:60000},{memberId:'megan',amount:40000}]});
  expect(plan.people.map(p=>p.amount)).toEqual([50000,50000]);
  expect(plan.payers[0].parts.map(p=>p.amount)).toEqual([30000,30000]);
  expect(plan.payers[1].parts.map(p=>p.amount)).toEqual([20000,20000]);
 });
 it('supports fractional share weights and deterministic penny rounding',()=>{
  const input={total:1001,method:'shares' as const,people:[{memberId:'a',value:'1.5'},{memberId:'b',value:'1'},{memberId:'c',value:'0.5'}],payers:[{memberId:'a',amount:1001}]};
  expect(planGroupBill(input).people.map(p=>p.amount)).toEqual([500,334,167]);
  expect(planGroupBill({...input,people:[...input.people].reverse()}).people.map(p=>p.amount)).toEqual([167,334,500]);
 });
 it('conserves each payer amount and every person’s exact cost across tiny and large totals',()=>{
  fc.assert(fc.property(fc.array(fc.integer({min:1,max:100000000}),{minLength:2,maxLength:12}),values=>{
   const total=values.reduce((n,v)=>n+v,0),people=values.map((_,i)=>({memberId:'person-'+i,value:'1'})),payers=values.map((amount,i)=>({memberId:'person-'+i,amount}));
   const plan=planGroupBill({total,method:'equal',people,payers});
   expect(plan.people.reduce((n,p)=>n+p.amount,0)).toBe(total);
   for(const payer of plan.payers)expect(payer.parts.reduce((n,p)=>n+p.amount,0)).toBe(payer.amount);
   for(const person of plan.people)expect(plan.payers.reduce((n,p)=>n+p.parts.find(a=>a.memberId===person.memberId)!.amount,0)).toBe(person.amount);
  }),{numRuns:100});
 });
 it('rejects incomplete totals, precision overflow, duplicate people and invalid weights',()=>{
  const base={total:1000,method:'percent' as const,people:[{memberId:'a',value:'50'},{memberId:'b',value:'50'}],payers:[{memberId:'a',amount:1000}]};
  expect(()=>planGroupBill({...base,people:[{memberId:'a',value:'50'},{memberId:'b',value:'49.99'}]})).toThrow('100%');
  expect(()=>planGroupBill({...base,people:[{memberId:'a',value:'50.001'},{memberId:'b',value:'49.999'}]})).toThrow();
  expect(()=>planGroupBill({...base,payers:[{memberId:'a',amount:999}]})).toThrow('Payments');
  expect(()=>planGroupBill({...base,method:'amount',people:[{memberId:'a',value:'3'},{memberId:'b',value:'6'}]})).toThrow('total');
  expect(()=>planGroupBill({...base,people:[base.people[0],base.people[0]]})).toThrow();
 });
});
it('keeps the original month/day anchor through short months and leap years',()=>{
 expect([0,1,2,3].map(i=>billOccurrence({start:'2027-01-31',interval:'month',every:1},i))).toEqual(['2027-01-31','2027-02-28','2027-03-31','2027-04-30']);
 expect(billOccurrence({start:'2028-02-29',interval:'year',every:1},4)).toBe('2032-02-29');
 expect(billOccurrence({start:'2026-09-12',interval:'week',every:2,until:'2026-09-26'},2)).toBeNull();
 expect(()=>billOccurrence({start:'2026-02-30',interval:'month',every:1},1)).toThrow();
});
