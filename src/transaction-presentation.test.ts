import {describe,expect,it} from 'vitest';
import {demoBudget} from './engine';
import type {Entry} from './engine';
import {setCleared} from './reconciliation';
import {transactionPresentation} from './transaction-presentation';

const budget=demoBudget();
const transfer:Entry={id:'transfer',kind:'transfer',date:'2026-09-12',accountId:'checking',toAccountId:'savings',amount:50000,payee:'Move to savings',note:'',cleared:true,clearedTo:false};

describe('transaction ledger account context',()=>{
 it('shows one neutral transfer in All accounts and the correct signed movement in each account',()=>{
  expect(transactionPresentation(budget,transfer)).toMatchObject({accountName:'Everyday checking',relation:'To High-yield savings',movement:'between',sign:'',reviewClearing:true,mixedClearing:true});
  expect(transactionPresentation(budget,transfer,'checking')).toMatchObject({accountName:'Everyday checking',relation:'To High-yield savings',movement:'out',sign:'−',cleared:true,uncleared:false});
  expect(transactionPresentation(budget,transfer,'savings')).toMatchObject({accountName:'High-yield savings',relation:'From Everyday checking',movement:'in',sign:'+',cleared:false,uncleared:true});
 });
 it('includes either uncleared side in All accounts without changing the other account when clearing one side',()=>{
  expect(transactionPresentation(budget,transfer).uncleared).toBe(true);
  const cleared=setCleared(transfer,'savings',true);
  expect(cleared.cleared).toBe(true);expect(transfer.clearedTo).toBe(false);
  expect(transactionPresentation(budget,cleared)).toMatchObject({uncleared:false,allCleared:true,mixedClearing:false});
  const sourceUncleared=setCleared(cleared,'checking',false);
  expect(sourceUncleared.clearedTo).toBe(true);
  expect(transactionPresentation(budget,sourceUncleared,'savings').uncleared).toBe(false);
  expect(transactionPresentation(budget,sourceUncleared).uncleared).toBe(true);
 });
 it('treats a card payment as an account transfer, and a refund as an inflow',()=>{
  const payment={...transfer,kind:'payment' as const,toAccountId:'visa'};
  expect(transactionPresentation(budget,payment)).toMatchObject({kindLabel:'Card payment',movement:'between',sign:''});
  expect(transactionPresentation(budget,payment,'visa')).toMatchObject({movement:'in',sign:'+',relation:'From Everyday checking'});
  const refund:Entry={id:'refund',kind:'refund',date:'2026-09-12',amount:1500,accountId:'visa',categoryId:'groceries',payee:'Shop',note:'',cleared:true,refundOf:'purchase'};
  expect(transactionPresentation(budget,refund)).toMatchObject({kindLabel:'Linked refund',movement:'in',sign:'+',reviewClearing:false});
 });
 it('keeps a share with no account separate from bank movements and clearing filters',()=>{
  const share:Entry={id:'share',kind:'shared_charge',amount:2500,date:'2026-09-12',categoryId:'dining',payee:'Shared dinner',note:'',cleared:false,sharedExpenseId:'bill',sharedShareId:'share'};
  expect(transactionPresentation(budget,share)).toMatchObject({accountName:'Paid by someone else',movement:'none',sign:'',uncleared:false,kindLabel:'Shared purchase'});
 });
});
