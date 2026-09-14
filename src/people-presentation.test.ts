import {describe,expect,it} from 'vitest';
import {acceptanceLabel,matchingShares,paymentPriority,peopleCurrencyTotals,shareAmounts,shareClosed,shareNextAction,shareReviewActions} from './people-presentation';
import type {Expense,Share} from './SharedExpenses';
import type {PersonBalance} from './PeopleOverview';

const share=(overrides:Partial<Share>={}):Share=>({id:'share',name:'Maya',email:'maya@example.test',personKey:'maya',amount:12000,state:'accepted',budgetId:null,confirmed:4000,pending:3000,offset:2000,settlements:[],...overrides});
const expense=(overrides:Partial<Expense>={}):Expense=>({id:'bill',owned:true,merchant:'Dinner',total:24000,currency:'USD',date:'2026-09-12',payer:'payer@example.test',entryId:null,budgetId:'budget',ledgerVersion:2,shares:[share()],...overrides});
const person=(overrides:Partial<PersonBalance>={}):PersonBalance=>({email:'maya@example.test',personKey:'maya',name:'Maya',currency:'USD',owedToYou:0,youOwe:0,pendingToYou:0,pendingFromYou:0,requestedToYou:0,requestedFromYou:0,...overrides});

describe('People presentation keeps acceptance and repayment separate',()=>{
 it('includes unconfirmed repayments in the balance without offering to record them twice',()=>{
  expect(shareAmounts(share())).toEqual({balance:6000,unrecorded:3000,confirmed:4000,pending:3000,offset:2000});
  expect(shareAmounts(share({pending:6000})).unrecorded).toBe(0);
 });
 it('preserves recorded receipt facts when a refund reduces the share below past repayments',()=>{
  expect(shareAmounts(share({amount:3000,confirmed:5000,pending:0,offset:0}))).toEqual({balance:0,unrecorded:0,confirmed:5000,pending:0,offset:0});
 });
 it('does not add pending invitations to the same recorded receivable twice or treat incoming requests as debt',()=>{
  expect(peopleCurrencyTotals([
   person({owedToYou:5000,requestedToYou:5000,pendingToYou:1000}),
   person({currency:'INR',youOwe:2000,requestedFromYou:3000}),
  ])).toEqual([{currency:'INR',incoming:0,outgoing:2000,requested:3000},{currency:'USD',incoming:5000,outgoing:0,requested:0}]);
 });
 it('does not turn cancelled or declined shares into payment confirmations',()=>{
  expect(acceptanceLabel('cancelled',true)).toBe('Share cancelled');
  expect(acceptanceLabel('declined',false)).toBe('Share declined');
  expect(acceptanceLabel('invited',false)).toBe('Your review is needed');
  expect(shareClosed(expense(),share({amount:0,state:'cancelled'}))).toBe(true);
  expect(shareClosed(expense(),share({state:'declined',confirmed:0,pending:0,offset:0}))).toBe(false);
  expect(shareClosed(expense({owned:false}),share({state:'declined',confirmed:0,pending:0,offset:0}))).toBe(true);
  expect(shareClosed(expense({ledgerVersion:1}),share({state:'declined',confirmed:0,pending:0,offset:0}))).toBe(true);
 });
 it('filters actual share rows by person and direction while keeping closed history available',()=>{
  const bill=expense({shares:[share(),share({id:'closed',personKey:'sam',state:'cancelled',confirmed:0,pending:0,offset:0})]});
  expect(matchingShares(bill,'maya','incoming').map(s=>s.id)).toEqual(['share']);
  expect(matchingShares(bill,'','outgoing')).toEqual([]);
  expect(matchingShares(bill,'','settled').map(s=>s.id)).toEqual(['closed']);
 });
 it('puts the user’s receipt checks and incoming reviews ahead of invitations waiting on others',()=>{
  const receipt=expense({shares:[share({settlements:[{id:'repayment',state:'pending',amount:3000,date:'2026-09-12'}]})]});
  const request=expense({owned:false,shares:[share({state:'invited',confirmed:0,pending:0,offset:0})]});
  const waiting=expense({shares:[share({state:'invited',confirmed:0,pending:0,offset:0})]});
  expect(paymentPriority(receipt)).toBeLessThan(paymentPriority(request));
  expect(paymentPriority(request)).toBeLessThan(paymentPriority(waiting));
 });
 it('allows recording receipt for a guest without presenting their unaccepted share as a review for the payer',()=>{
  const guest=share({state:'invited',confirmed:0,pending:0,offset:0});
  expect(shareReviewActions(expense(),guest)).toEqual([]);
  expect(shareNextAction(expense(),guest)).toEqual({kind:'receive'});
  expect(shareNextAction(expense({owned:false}),guest)).toEqual({kind:'accept'});
 });
 it('prioritizes an existing reported payment and never offers to record a fully pending repayment again',()=>{
  const settlement={id:'pending',state:'pending',amount:8000,date:'2026-09-12'};
  const paid=share({amount:8000,confirmed:0,pending:8000,offset:0,settlements:[settlement]});
  expect(shareNextAction(expense(),paid)).toEqual({kind:'confirm',settlement});
  expect(shareReviewActions(expense({owned:false}),paid)).toEqual([]);
  expect(shareNextAction(expense({owned:false}),paid)).toBeUndefined();
  expect(shareNextAction(expense(),{...paid,settlements:[settlement,{...settlement,id:'second'}]})).toEqual({kind:'details'});
 });
 it('keeps an unimported confirmed repayment actionable even after the shared balance is settled',()=>{
  const settlement={id:'received',state:'confirmed',amount:12000,date:'2026-09-12',recordedByPayer:true,recordedInYourBudget:false};
  const settled=share({confirmed:12000,pending:0,offset:0,settlements:[settlement]});
  expect(shareClosed(expense({owned:false}),settled)).toBe(true);
  expect(shareNextAction(expense({owned:false}),settled)).toEqual({kind:'import',settlement});
  expect(paymentPriority(expense({owned:false,shares:[settled]}))).toBe(0);
  expect(shareNextAction(expense({owned:false}),{...settled,settlements:[{...settlement,recordedInYourBudget:true}]})).toBeUndefined();
 });
 it('requires coordinated changes to be reviewed before showing money actions, and retains terminal states',()=>{
  const changed=share({reviewPending:true,pendingChangeId:'change'});
  expect(shareNextAction(expense(),changed)).toEqual({kind:'change',changeId:'change'});
  expect(shareNextAction(expense(),{...changed,pendingChangeId:undefined})).toEqual({kind:'details'});
  for(const state of ['cancelled','refunded'])expect(shareNextAction(expense(),share({state}))).toBeUndefined();
  expect(shareNextAction(expense({owned:false}),share({state:'declined'}))).toBeUndefined();
 });
});
