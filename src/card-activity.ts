import {effectiveEntries} from './engine';
import type { Budget } from './engine';

export type CardActivityMonth={month:string;purchases:number;refunds:number;spending:number;payments:number};
/** Reporting follows transaction dates. An issuer statement never moves spending into a different month. */
export function cardActivity(budget:Budget,accountId:string,month:string):CardActivityMonth[] {
 const [year,number]=month.split('-').map(Number);
 const rows:CardActivityMonth[]=Array.from({length:3},(_,index)=>{
  const date=new Date(year,number-3+index,1);
  return {month:date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0'),purchases:0,refunds:0,spending:0,payments:0};
 });
 for(const entry of effectiveEntries(budget)){
  const row=rows.find(row=>row.month===entry.date.slice(0,7));
  if(!row)continue;
  if(entry.accountId===accountId&&entry.kind==='expense')row.purchases+=entry.amount;
  if(entry.accountId===accountId&&(entry.kind==='refund'||entry.kind==='shared_refund'))row.refunds+=entry.amount;
  if(entry.toAccountId===accountId&&entry.kind==='payment')row.payments+=entry.amount;
 }
 for(const row of rows)row.spending=row.purchases-row.refunds;
 return rows;
}
