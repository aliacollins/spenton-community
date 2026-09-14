export type SplitMethod='equal'|'amount'|'percent'|'shares';
export type SplitInput={memberId:string;value:string};
export type BillPlanInput={total:number;method:SplitMethod;people:SplitInput[];payers:{memberId:string;amount:number}[]};
export type BillPlan={total:number;method:SplitMethod;people:{memberId:string;value:string;amount:number}[];payers:{memberId:string;amount:number;parts:{memberId:string;amount:number}[]}[]};
const limit=1_000_000_000_000;
const validAmount=(n:number)=>Number.isSafeInteger(n)&&n>=0&&n<=limit;
function decimal(value:string,places:number){
 if(typeof value!=='string'||!new RegExp('^\\d{1,12}(?:\\.\\d{1,'+places+'})?$').test(value.trim()))throw new Error('Enter a positive number with up to '+places+' decimal places.');
 const [whole,fraction='']=value.trim().split('.');
 const n=BigInt(whole)*10n**BigInt(places)+BigInt(fraction.padEnd(places,'0'));
 if(n>BigInt(limit))throw new Error('This value is too large.');
 return n;
}
function apportion(total:number,weights:{memberId:string;weight:bigint}[]){
 const sum=weights.reduce((n,p)=>n+p.weight,0n);
 if(sum<=0n)throw new Error('Choose at least one positive share.');
 const rows=weights.map(p=>({...p,amount:Number(BigInt(total)*p.weight/sum),remainder:BigInt(total)*p.weight%sum}));
 let left=total-rows.reduce((n,p)=>n+p.amount,0);
 for(const row of [...rows].sort((a,b)=>a.remainder===b.remainder?(a.memberId<b.memberId?-1:1):a.remainder>b.remainder?-1:1)){if(!left)break;if(row.weight>0n){row.amount++;left--;}}
 return rows.map(({memberId,amount})=>({memberId,amount}));
}
/** Stable largest-remainder rounding keeps every minor unit and both matrix margins. */
export function planGroupBill(input:BillPlanInput):BillPlan{
 const {total,method,people,payers}=input;
 if(!validAmount(total)||total===0)throw new Error('Enter a bill total greater than zero.');
 if(!['equal','amount','percent','shares'].includes(method)||!Array.isArray(people)||!people.length||people.length>21||new Set(people.map(p=>p.memberId)).size!==people.length||people.some(p=>typeof p.memberId!=='string'||!p.memberId||p.memberId.length>100))throw new Error('Choose each person once and a supported split method.');
 const weights=people.map(p=>({memberId:p.memberId,weight:method==='equal'?1n:decimal(p.value,method==='shares'?4:2)}));
 const sum=weights.reduce((n,p)=>n+p.weight,0n);
 if(method==='percent'&&sum!==10000n)throw new Error('Percentages must add up to 100%.');
 if(method==='amount'&&sum!==BigInt(total))throw new Error('Everyone’s amounts must add up to the bill total.');
 const amounts=method==='amount'?weights.map(p=>({memberId:p.memberId,amount:Number(p.weight)})):apportion(total,weights);
 if(!Array.isArray(payers)||!payers.length||payers.length>20||new Set(payers.map(p=>p.memberId)).size!==payers.length||payers.some(p=>typeof p.memberId!=='string'||!p.memberId||p.memberId.length>100||!validAmount(p.amount)||!p.amount)||payers.reduce((n,p)=>n+p.amount,0)!==total)throw new Error('Payments must add up to the bill total.');
 const remaining=new Map(amounts.map(p=>[p.memberId,p.amount]));
 const contributions=[...payers].sort((a,b)=>a.memberId<b.memberId?-1:1).map(payer=>{
  const parts=apportion(payer.amount,people.map(p=>({memberId:p.memberId,weight:BigInt(remaining.get(p.memberId)!)})));
  for(const part of parts)remaining.set(part.memberId,remaining.get(part.memberId)!-part.amount);
  return {...payer,parts};
 });
 return {total,method,people:people.map(p=>({...p,amount:amounts.find(a=>a.memberId===p.memberId)!.amount})),payers:contributions};
}
export type BillSchedule={start:string;interval:'week'|'month'|'year';every:number;until?:string};
export function isBillDate(value:unknown):value is string{
 return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
}
export function billOccurrence(schedule:BillSchedule,index:number):string|null{
 if(!isBillDate(schedule.start)||!['week','month','year'].includes(schedule.interval)||!Number.isInteger(schedule.every)||schedule.every<1||schedule.every>12||!Number.isInteger(index)||index<0||index>10000||(schedule.until&&(!isBillDate(schedule.until)||schedule.until<schedule.start)))throw new Error('Choose a valid repeat schedule and end date.');
 const date=new Date(schedule.start+'T12:00:00Z'),day=date.getUTCDate(),step=schedule.every*index;
 if(schedule.interval==='week')date.setUTCDate(day+7*step);
 else{date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+step*(schedule.interval==='year'?12:1));const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(day,last));}
 const result=date.toISOString().slice(0,10);
 if(!isBillDate(result)||result>'2199-12-31')return null;
 return schedule.until&&result>schedule.until?null:result;
}
