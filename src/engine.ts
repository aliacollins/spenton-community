import { z } from 'zod';

export const id = () => crypto.randomUUID();
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
export const thisMonth = () => today().slice(0,7);
export const monthEnd = (month:string) => {const [y,m]=month.split('-').map(Number);return `${month}-${new Date(y,m,0).getDate()}`;};
export const money = (value:number,currency='USD') => new Intl.NumberFormat(currency==='INR'?'en-IN':'en-US',{style:'currency',currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(value/100);
export function cents(text:string):number {
  const valueText=text.trim().replace(/^([+-]?)\s*[$€£₹]\s*/,'$1').replace(/\s*[$€£₹]$/,'').trim();
  const numberPattern=/^[+-]?(?:(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3})(?:\.\d{0,2})?|\.\d{1,2})$/;
  if(!numberPattern.test(valueText))throw new Error('Enter an amount with up to two decimal places. Use commas only for thousands, like 1,250.50.');
  const cleaned=valueText.replace(/,/g,'');
  const negative=cleaned.startsWith('-');const [whole,fraction='']=cleaned.replace(/^[+-]/,'').split('.');
  const value=Number(whole||'0')*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(value)||value>1_000_000_000_000)throw new Error('That amount is too large.');
  return negative?-value:value;
}
const identifier=z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/,'Invalid record identifier.').refine(value=>!['__proto__','prototype','constructor'].includes(value),'Invalid record identifier.');
const nameText=(max:number)=>z.string().trim().min(1).max(max).regex(/^[^<>\u0000-\u001f\u007f]+$/,'Use plain text without markup or control characters.');
const amountSchema=z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);
const dateSchema=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v,'Invalid date');
const accountSchema=z.object({id:identifier,name:nameText(80),type:z.enum(['checking','savings','credit','investment']),opening:amountSchema,date:dateSchema,lastFour:z.string().max(4).default(''),statement:z.object({amount:amountSchema.nonnegative(),minimum:amountSchema.nonnegative(),closed:dateSchema,due:dateSchema}).optional()});
const targetMonthSchema=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const categorySchema=z.object({id:identifier,name:nameText(80),group:nameText(60),parentId:identifier.optional(),icon:z.string().max(32).refine(value=>['home','basket','car','zap','repeat','coffee','heart','sparkles','umbrella','plane','laptop','wallet','paw','baby','study','health','gift','food','phone','bike','music','shirt'].includes(value),'Choose a supported category icon.'),target:amountSchema.nonnegative(),targetType:z.enum(['monthly','balance','capped']),targetCap:amountSchema.nonnegative().optional(),targetDate:dateSchema.optional(),targetPausedMonths:z.array(targetMonthSchema).max(1200).optional(),color:z.string().max(20).refine(value=>['sage','sand','blue','butter','lavender','peach','rose'].includes(value),'Choose a supported category color.')}).refine(c=>c.targetType!=='capped'||(c.targetCap!==undefined&&c.targetCap>0),'A capped target needs a positive balance limit.');
const entrySchema=z.object({id:identifier,date:dateSchema,kind:z.enum(['expense','income','payment','transfer','allocation','refund','adjustment','shared_charge','shared_payment','shared_receipt','shared_offset','shared_refund','shared_credit','shared_claim','shared_return','shared_void']),amount:amountSchema.positive(),accountId:identifier.optional(),toAccountId:identifier.optional(),categoryId:identifier.optional(),from:identifier.optional(),to:identifier.optional(),payee:z.string().trim().max(160).regex(/^[^<>\u0000-\u001f\u007f]*$/,'Use a plain-text payee name.').default(''),note:z.string().max(500).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/,'Remove control characters from the note.').default(''),cleared:z.boolean().default(true),importKey:z.string().max(512).optional(),scheduleKey:z.string().max(200).optional(),refundOf:identifier.optional(),receiptId:identifier.optional(),reimbursement:z.boolean().optional(),sharedSettlementId:identifier.optional(),sharedExpenseId:identifier.optional(),sharedShareId:identifier.optional(),sharedAmount:amountSchema.nonnegative().optional(),sharedReduction:amountSchema.nonnegative().optional(),againstExpenseId:identifier.optional(),reversalOf:identifier.optional(),direction:z.enum(['in','out']).optional(),clearedTo:z.boolean().optional(),splits:z.array(z.object({categoryId:identifier,amount:amountSchema.positive()})).min(2).max(100).optional()});
const plannedPerson=z.object({id:z.string().min(1).max(254).regex(/^[^<>\u0000-\u001f\u007f]+$/),name:nameText(100),email:z.string().max(254).refine(v=>!v||/^\S+@[^\s@]+\.[^\s@]+$/.test(v)).default(''),memberId:identifier.optional(),amount:z.string().max(40).default('')});
export const sharePlanSchema=z.object({people:z.array(plannedPerson).min(1).max(20),method:z.enum(['equal','amount']),groupId:z.string().max(160).default(''),groupName:z.string().max(100).default(''),groupRevision:z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),includeReceipt:z.boolean().default(false)})
 .refine(p=>new Set(p.people.map(v=>v.id)).size===p.people.length,'Choose each person once.');
const scheduleSchema=z.object({id:identifier,frequency:z.enum(['once','weekly','monthly','yearly']),nextDate:dateSchema,template:entrySchema,subscription:z.boolean().optional()});
export const budgetSchema=z.object({version:z.union([z.literal(1),z.literal(2),z.literal(3)]),name:nameText(80),currency:z.enum(['USD','INR','EUR','GBP','CAD','AUD']),demo:z.boolean(),groups:z.array(nameText(60)).max(500).optional(),accounts:z.array(accountSchema).max(100),categories:z.array(categorySchema).max(500),entries:z.array(entrySchema).max(50000),schedules:z.array(scheduleSchema).max(1000).optional(),reconciliations:z.array(z.object({id:identifier,accountId:identifier,date:dateSchema,balance:amountSchema,signature:z.string().max(100)})).max(10000).optional()});
export type Schedule=z.infer<typeof scheduleSchema>;
export type Account=z.infer<typeof accountSchema>;
export const isCashAccount=(account:Pick<Account,'type'>)=>account.type==='checking'||account.type==='savings';
export function canUseAccountForEntry(account:Pick<Account,'type'>,kind:Entry['kind']):boolean {
 if(kind==='income'||kind==='payment')return isCashAccount(account);
 if(kind==='transfer')return account.type!=='credit';
 if(kind==='expense'||kind==='refund')return account.type!=='investment';
 return kind==='adjustment';
}
export type Category=z.infer<typeof categorySchema>;
export type Entry=z.infer<typeof entrySchema>;
export type Budget=z.infer<typeof budgetSchema>;
type Lot={entryId?:string;sharedExpenseId?:string;accountId:string;categoryId?:string;remaining:number;backed:number};
export type CategoryTotal={cash:number;unfunded:number;available:number;assigned:number;spent:number;carry:number};
export type CardTotal={reserve:number;owed:number;credit:number;unbacked:number;statementRemaining:number;statementGap:number;minimumRemaining:number};
export type SharedObligation={categoryId:string;owed:number;reserve:number};
export type SharedTotals={receivable:number;owed:number;reserved:number;unfunded:number;receivables:Record<string,number>;obligations:Record<string,SharedObligation>};
export const spendingAmount=(e:Entry)=>e.kind==='refund'||e.kind==='shared_credit'?-e.amount:e.kind==='shared_refund'?-(e.amount-(e.sharedAmount??0)):e.kind==='expense'?e.amount-(e.sharedAmount??0):e.kind==='shared_charge'?e.amount:0;
export const effectiveEntries=(b:Pick<Budget,'entries'>)=>{const voided=new Set(b.entries.filter(e=>e.kind==='shared_void').map(e=>e.reversalOf));return b.entries.filter(e=>e.kind!=='shared_void'&&!voided.has(e.id));};
export const isSharedEntry=(e:Entry)=>!!(e.sharedExpenseId||e.sharedShareId||e.sharedSettlementId);
/** Allocate integer minor units proportionally without multiplying JS numbers. */
export function proportionalAmounts(total:number,weights:{categoryId:string;amount:number}[]){
 if(!Number.isSafeInteger(total)||total<0||weights.some(p=>!Number.isSafeInteger(p.amount)||p.amount<0))throw new Error('Check the category amounts.');
 const weight=weights.reduce((n,p)=>n+p.amount,0);
 if(!Number.isSafeInteger(weight)||weight<=0){if(total===0)return weights.map(p=>({...p,amount:0}));throw new Error('Choose categories with an amount.');}
 const rows=weights.map((p,index)=>{const product=BigInt(total)*BigInt(p.amount);return {categoryId:p.categoryId,amount:Number(product/BigInt(weight)),remainder:product%BigInt(weight),index};});
 let left=total-rows.reduce((n,p)=>n+p.amount,0);
 for(const row of [...rows].sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1)){if(left--<=0)break;row.amount++;}
 return rows.map(({categoryId,amount})=>({categoryId,amount}));
}
export function personalCategoryParts(entry:Entry){
 const parts=entry.splits??[{categoryId:entry.categoryId!,amount:entry.amount}];
 return entry.sharedAmount===undefined?parts:proportionalAmounts(entry.amount-entry.sharedAmount,parts);
}
export function sharedRefundCategoryParts(b:Pick<Budget,'entries'>,refund:Entry){
 const purchase=b.entries.find(e=>e.id===refund.refundOf);
 if(!purchase||purchase.kind!=='expense')throw new Error('Review the original shared purchase.');
 let remaining=personalCategoryParts(purchase).map(p=>({...p}));
 const refunds=b.entries.map((entry,index)=>({entry,index})).filter(({entry})=>entry.kind==='shared_refund'&&entry.refundOf===purchase.id)
  .sort((a,c)=>a.entry.date.localeCompare(c.entry.date)||a.index-c.index);
 for(const {entry} of refunds){
  const personal=entry.amount-(entry.sharedAmount??0);
  if(personal>remaining.reduce((n,p)=>n+p.amount,0))throw new Error('Refunds cannot exceed your original personal spending.');
  const parts=proportionalAmounts(personal,remaining);
  if(entry.id===refund.id)return parts;
  remaining=remaining.map((p,i)=>({...p,amount:p.amount-parts[i].amount}));
 }
 throw new Error('Review the shared refund.');
}
export type Totals={shared:SharedTotals;cash:number;ready:number;unassignedBeforeShortfalls:number;cashShortfall:number;netWorth:number;balances:Record<string,number>;categories:Record<string,CategoryTotal>;cards:Record<string,CardTotal>;spent:number;income:number;transactions:Entry[]};

export function validateBudget(input:unknown):Budget {
 if(input&&typeof input==='object'&&'version' in input&&![1,2,3].includes(Number(input.version)))throw new Error('Update SpentOn to open this budget. Your saved data is unchanged.');
 const b=budgetSchema.parse(input);
 if(b.version===1&&b.entries.some(e=>e.sharedExpenseId||e.sharedShareId||e.sharedAmount!==undefined||e.kind.startsWith('shared_')))throw new Error('Shared-budget accounting requires budget version 2.');
 if(b.version<3&&b.entries.some(e=>['shared_offset','shared_refund','shared_credit','shared_claim','shared_return','shared_void'].includes(e.kind)||e.sharedReduction!==undefined||e.againstExpenseId||e.reversalOf))throw new Error('Groups, offsets and shared corrections require budget version 3.');
 let magnitude=0;for(const amount of [...b.accounts.map(a=>Math.abs(a.opening)),...b.entries.map(e=>e.amount)]){magnitude+=amount;if(magnitude>Number.MAX_SAFE_INTEGER/4)throw new Error('This budget exceeds the supported total amount.');}
 if([...b.entries,...(b.schedules??[]).map(s=>s.template)].some(e=>e.receiptId&&e.kind!=='expense'))throw new Error('A scanned bill must be a purchase.');
 const receiptIds=[...b.entries,...(b.schedules??[]).map(s=>s.template)].flatMap(e=>e.receiptId?[e.receiptId]:[]);
 if(new Set(receiptIds).size!==receiptIds.length)throw new Error('This scanned bill is already recorded or scheduled. Open the existing transaction.');
 if((b.schedules??[]).some(s=>s.template.receiptId&&s.frequency!=='once'))throw new Error('A scanned bill represents one purchase. Create a separate schedule for repeating bills.');
 if((b.schedules??[]).some(s=>s.subscription&&(s.frequency==='once'||s.template.kind!=='expense')))throw new Error('A subscription must be a repeating expense.');
 const accountIds=new Set(b.accounts.map(a=>a.id));const categoryIds=new Set(b.categories.map(c=>c.id));
 if(accountIds.size!==b.accounts.length||categoryIds.size!==b.categories.length||new Set(b.entries.map(e=>e.id)).size!==b.entries.length)throw new Error('The backup contains duplicate IDs.');
 for(const category of b.categories){
  if(category.id==='ready'||category.id.startsWith('card:'))throw new Error('A category uses a reserved ID.');
  if(category.parentId){
   const parent=b.categories.find(c=>c.id===category.parentId);
   if(!parent||parent.id===category.id||parent.parentId||parent.group!==category.group)throw new Error('A subcategory must belong to a top-level category in the same group.');
  }
 }
 const validBucket=(s:string|undefined)=>s==='ready'||(s?.startsWith('card:')?b.accounts.some(a=>a.id===s.slice(5)&&a.type==='credit'):categoryIds.has(s??''));
 const refunded=new Map<string,number>();
 const entryPositions=new Map(b.entries.map((e,i)=>[e.id,i]));
 for(const e of b.entries){
  const a=b.accounts.find(a=>a.id===e.accountId);const to=b.accounts.find(a=>a.id===e.toAccountId);
  if(e.kind==='allocation'){
   if(!validBucket(e.from)||!validBucket(e.to)||e.from===e.to)throw new Error('Invalid allocation in backup.');
  }else if(['shared_charge','shared_return','shared_credit','shared_claim','shared_offset','shared_void'].includes(e.kind)){
   if(a||e.accountId||!categoryIds.has(e.categoryId??'')||!e.sharedShareId||!e.sharedExpenseId)throw new Error('An accepted share needs a category and no bank movement.');
  }else{
   if(!a||e.date<a.date)throw new Error('A transaction has an invalid account or predates its opening.');
   const sharedSplitRefund=e.kind==='shared_refund'&&b.entries.some(p=>p.id===e.refundOf&&p.splits);
   if((e.kind==='expense'||e.kind==='refund'||e.kind==='shared_refund')&&!e.splits&&!sharedSplitRefund&&!categoryIds.has(e.categoryId??''))throw new Error('A purchase needs a valid category.');
   if(a.type==='investment'&&!['transfer','adjustment'].includes(e.kind))throw new Error('Investment accounts support transfers and balance updates. Record income and spending in a budget account.');
   if(e.kind==='income'&&!isCashAccount(a))throw new Error('Income must go into a cash account.');
   if(e.kind==='payment'&&(!to||to.type!=='credit'||!isCashAccount(a)))throw new Error('Payments must go from a cash account to a credit card.');
   if(e.kind==='transfer'&&(!to||to.id===a.id||to.type==='credit'||a.type==='credit'))throw new Error('Transfers need two different cash or investment accounts.');
   if(to&&e.date<to.date)throw new Error('A transfer predates the receiving account.');
  }
  if(e.kind==='refund'||e.kind==='shared_refund'){
   const purchase=b.entries.find(p=>p.id===e.refundOf);
   if(!purchase||purchase.kind!=='expense'||(purchase.accountId!==e.accountId&&!e.reimbursement)||e.date<purchase.date||(e.date===purchase.date&&entryPositions.get(e.id)!<entryPositions.get(purchase.id)!))throw new Error('A refund must follow its original purchase in the same account.');
   const original=new Map<string,number>();
   for(const part of personalCategoryParts(purchase))original.set(part.categoryId,(original.get(part.categoryId)??0)+part.amount);
   const refundParts=e.kind==='shared_refund'&&purchase.splits?sharedRefundCategoryParts(b,e):e.splits??[{categoryId:e.categoryId!,amount:e.amount-(e.kind==='shared_refund'?(e.sharedAmount??0):0)}];
   for(const part of refundParts){
    const key=JSON.stringify([purchase.id,part.categoryId]);const total=(refunded.get(key)??0)+part.amount;
    if(!original.has(part.categoryId)||total>original.get(part.categoryId)!)throw new Error('Refunds cannot exceed the original purchase amount in each category.');
    refunded.set(key,total);
   }
  }else if(e.refundOf)throw new Error('Only refunds can link to a purchase.');
  if(e.reimbursement&&(e.kind!=='refund'||!a||!isCashAccount(a)))throw new Error('A reimbursement must return money to a cash account and link to its original purchase.');
  if(e.sharedSettlementId&&!['expense','refund','shared_payment','shared_receipt','shared_offset','shared_refund','shared_credit','shared_claim','shared_return','shared_void'].includes(e.kind))throw new Error('Only purchases and reimbursements can record shared repayments.');
  if(e.sharedAmount!==undefined&&(!['expense','shared_refund'].includes(e.kind)||!e.sharedExpenseId||e.sharedAmount>e.amount))throw new Error('A shared purchase must keep its full account amount and valid personal share.');
  if(e.kind.startsWith('shared_')&&(!e.sharedExpenseId||(e.kind!=='shared_refund'&&!e.sharedShareId)||e.splits||e.toAccountId||(e.refundOf&&e.kind!=='shared_refund')||e.from||e.to))throw new Error('Invalid shared-budget entry.');
  if((e.sharedExpenseId||e.sharedShareId)&&e.kind!=='expense'&&!e.kind.startsWith('shared_'))throw new Error('Invalid shared-budget link.');
  if(e.sharedReduction!==undefined&&(!['shared_refund','shared_credit'].includes(e.kind)||e.sharedReduction>(e.kind==='shared_refund'?(e.sharedAmount??0):e.amount)))throw new Error('Invalid shared refund credit.');
  if(e.againstExpenseId&&e.kind!=='shared_offset')throw new Error('Only offsets can match another bill.');
  if(e.reversalOf&&e.kind!=='shared_void')throw new Error('Only reversals can void a repayment.');
  if(e.kind==='shared_refund'&&(!e.refundOf||e.sharedAmount===undefined||e.sharedReduction===undefined))throw new Error('Review the shared refund and its original bill.');
  if(e.kind==='shared_credit'&&e.sharedReduction===undefined)throw new Error('Review the credit against your share.');
  if(e.kind==='shared_offset'&&(!e.againstExpenseId||!e.sharedSettlementId))throw new Error('Offsets need both original bills.');
  if(e.kind==='shared_void'){const original=b.entries.find(x=>x.id===e.reversalOf);if(!original||!['shared_payment','shared_receipt','shared_offset'].includes(original.kind)||e.amount!==original.amount||e.date!==original.date||!e.note.trim()||original.sharedExpenseId!==e.sharedExpenseId||original.sharedShareId!==e.sharedShareId||b.entries.filter(x=>x.reversalOf===e.reversalOf).length!==1)throw new Error('A reversal must identify one original repayment or offset and a reason.');}
  if(e.kind==='expense'&&e.sharedShareId)throw new Error('A shared purchase cannot be an accepted share.');
  if(['shared_payment','shared_receipt'].includes(e.kind)&&(!a||!isCashAccount(a)||!e.sharedSettlementId))throw new Error('Record shared payments in a bank or cash account.');
  if(e.kind==='adjustment'&&(!e.direction||!e.note.trim()))throw new Error('A balance adjustment needs a direction and a reason.');
  if(e.kind!=='adjustment'&&e.direction)throw new Error('Only balance adjustments can specify a direction.');
  if(e.splits&&(!['expense','refund'].includes(e.kind)||e.categoryId!==undefined||e.splits.some(s=>!categoryIds.has(s.categoryId))||e.splits.reduce((n,s)=>n+s.amount,0)!==e.amount))throw new Error('Split categories must be valid and their amounts must equal the purchase total.');
 }
 if(new Set((b.schedules??[]).map(s=>s.id)).size!==(b.schedules??[]).length)throw new Error('Duplicate recurring entry IDs.');
 for(const s of b.schedules??[]){
  if(s.template.kind.startsWith('shared_')||isSharedEntry(s.template)||['allocation','refund','adjustment'].includes(s.template.kind)||s.nextDate<s.template.date)throw new Error('Invalid recurring entry.');
  validateBudget({...b,schedules:[],entries:[s.template]});
 }
 validateSharedLinks(b);
 for(const r of b.reconciliations??[])if(!accountIds.has(r.accountId)||r.date<b.accounts.find(a=>a.id===r.accountId)!.date)throw new Error('Invalid reconciliation account or date.');
 return b;
}

function validateSharedLinks(b:Budget){
 const charges=new Map<string,Entry>(),purchases=new Map<string,Entry>(),paid=new Map<string,number>(),received=new Map<string,number>(),credits=new Map<string,number>(),refunds=new Map<string,number>(),sharedRefunds=new Map<string,number>(),settlements=new Set<string>();
 const receive=(expenseId:string,value:number)=>{const purchase=purchases.get(expenseId),total=(received.get(expenseId)??0)+value;if(!purchase||total>(purchase.kind==='shared_claim'?purchase.amount:purchase.sharedAmount??0))throw new Error('Money received must follow a shared purchase and stay within the amount owed.');received.set(expenseId,total);};
 const pay=(shareId:string,expenseId:string,value:number,categoryId?:string)=>{const charge=charges.get(shareId),total=(paid.get(shareId)??0)+value;if(!charge||charge.sharedExpenseId!==expenseId||charge.categoryId!==categoryId||total>charge.amount)throw new Error('Repayments must follow an accepted share and stay within its amount.');paid.set(shareId,total);};
 for(const e of effectiveEntries(b).slice().sort((a,c)=>a.date.localeCompare(c.date))){
  if((e.kind==='expense'&&e.sharedExpenseId)||e.kind==='shared_claim'){if(purchases.has(e.sharedExpenseId!)||(e.kind==='expense'&&e.sharedAmount===undefined))throw new Error('Duplicate or incomplete shared purchase.');purchases.set(e.sharedExpenseId!,e);}
  if(e.kind==='shared_charge'||e.kind==='shared_return'){if(charges.has(e.sharedShareId!))throw new Error('This share is already in the budget.');charges.set(e.sharedShareId!,e);}
  if(e.sharedSettlementId){if(settlements.has(e.sharedSettlementId))throw new Error('This shared payment is already recorded.');settlements.add(e.sharedSettlementId);}
  if(e.kind==='shared_payment')pay(e.sharedShareId!,e.sharedExpenseId!,e.amount,e.categoryId);
  if(e.kind==='shared_receipt')receive(e.sharedExpenseId!,e.amount);
  if(e.kind==='shared_offset'){pay(e.sharedShareId!,e.againstExpenseId!,e.amount,e.categoryId);receive(e.sharedExpenseId!,e.amount);}
  if(e.kind==='shared_credit'){
   const charge=charges.get(e.sharedShareId!),total=(credits.get(e.sharedShareId!)??0)+e.amount;
   if(!charge||charge.kind!=='shared_charge'||charge.categoryId!==e.categoryId||total>charge.amount)throw new Error('A refund cannot exceed the accepted share.');
   credits.set(e.sharedShareId!,total);pay(e.sharedShareId!,e.sharedExpenseId!,e.sharedReduction!,e.categoryId);
  }
  if(e.kind==='shared_refund'){
   const purchase=purchases.get(e.sharedExpenseId!),total=(refunds.get(e.sharedExpenseId!)??0)+e.amount,others=(sharedRefunds.get(e.sharedExpenseId!)??0)+e.sharedAmount!;
   if(!purchase||purchase.kind!=='expense'||purchase.id!==e.refundOf||purchase.accountId!==e.accountId||purchase.categoryId!==e.categoryId||total>purchase.amount||others>(purchase.sharedAmount??0))throw new Error('A shared refund must fit the original purchase.');
   refunds.set(e.sharedExpenseId!,total);sharedRefunds.set(e.sharedExpenseId!,others);receive(e.sharedExpenseId!,e.sharedReduction!);
  }
 }
}

export function calculate(b:Budget,month:string):Totals{
 const end=monthEnd(month);const start=month+'-01';
 const balances:Record<string,number>=Object.create(null);const cats:Record<string,CategoryTotal>=Object.create(null);const cards:Record<string,CardTotal>=Object.create(null);const lots:Lot[]=[];
 const receivables:Record<string,number>=Object.create(null),obligations:Record<string,SharedObligation>=Object.create(null);
 let ready=0,spent=0,income=0;
 for(const c of b.categories)cats[c.id]={cash:0,unfunded:0,available:0,assigned:0,spent:0,carry:0};
 for(const a of b.accounts){
  balances[a.id]=a.date<=end?a.opening:0;
  if(a.type==='credit'){
   cards[a.id]={reserve:0,owed:0,credit:0,unbacked:0,statementRemaining:a.statement&&a.statement.closed<=end?a.statement.amount:0,statementGap:0,minimumRemaining:a.statement&&a.statement.closed<=end?a.statement.minimum:0};
   if(a.date<=end&&a.opening<0)lots.push({accountId:a.id,remaining:-a.opening,backed:0});
  }else if(isCashAccount(a)&&a.date<=end)ready+=a.opening;
 }
 const fundLots=(accountId:string,amount:number,categoryId?:string)=>{
  let remaining=amount;
  for(const lot of lots){
   if(lot.accountId!==accountId||(categoryId&&lot.categoryId!==categoryId))continue;
   const move=Math.min(remaining,lot.remaining-lot.backed);lot.backed+=move;remaining-=move;
  }
  return amount-remaining;
 };
 const unback=(accountId:string,amount:number)=>{
  let remaining=amount;
  for(const lot of [...lots].reverse()){if(lot.accountId!==accountId)continue;const moved=Math.min(remaining,lot.backed);lot.backed-=moved;remaining-=moved;}
 };
 const moveBucket=(bucket:string,delta:number,inMonth:boolean)=>{
  if(bucket==='ready'){ready+=delta;return;}
  if(bucket.startsWith('card:')){const cardId=bucket.slice(5);cards[cardId].reserve+=delta;if(delta>0)fundLots(cardId,delta);else unback(cardId,-delta);return;}
  const cat=cats[bucket];if(inMonth)cat.assigned+=delta;
  if(delta<=0){cat.cash+=delta;return;}
  let remaining=delta;
  // Cover cash overspending before backing outstanding card purchases.
  const cashGap=Math.min(remaining,Math.max(0,-cat.cash));cat.cash+=cashGap;remaining-=cashGap;
  for(const lot of lots){if(lot.categoryId!==bucket)continue;const cover=Math.min(remaining,lot.remaining-lot.backed);lot.backed+=cover;cards[lot.accountId].reserve+=cover;remaining-=cover;}
  for(const obligation of Object.values(obligations)){if(obligation.categoryId!==bucket)continue;const cover=Math.min(remaining,Math.max(0,obligation.owed-obligation.reserve));obligation.reserve+=cover;remaining-=cover;}
  cat.cash+=remaining;
 };
 const ordered=effectiveEntries(b).map((entry,index)=>({entry,index})).filter(({entry})=>entry.date<=end).sort((a,c)=>a.entry.date.localeCompare(c.entry.date)||a.index-c.index);
 let captured=false;
 const captureCarry=()=>{for(const [key,cat]of Object.entries(cats))cat.carry=cat.cash-lots.filter(l=>l.categoryId===key).reduce((n,l)=>n+l.remaining-l.backed,0)-Object.values(obligations).filter(o=>o.categoryId===key).reduce((n,o)=>n+Math.max(0,o.owed-o.reserve),0);};
 for(const {entry:e}of ordered.flatMap(({entry,index})=>entry.splits&&entry.kind!=='expense'?entry.splits.map(s=>({index,entry:{...entry,...s,splits:undefined}})):[{entry,index}])){
  const inMonth=e.date>=start;
  if(inMonth&&!captured){captureCarry();captured=true;}
  if(e.kind==='allocation'){moveBucket(e.from!,-e.amount,inMonth);moveBucket(e.to!,e.amount,inMonth);continue;}
  if(e.kind==='shared_claim'){receivables[e.sharedExpenseId!]=e.amount;continue;}
  if(e.kind==='shared_credit'){const obligation=obligations[e.sharedShareId!];obligation.owed-=e.sharedReduction!;const released=Math.max(0,obligation.reserve-obligation.owed);obligation.reserve-=released;if(released)moveBucket(obligation.categoryId,released,false);if(inMonth){cats[obligation.categoryId].spent-=e.amount;spent-=e.amount;}continue;}
  if(e.kind==='shared_offset'){const obligation=obligations[e.sharedShareId!];obligation.owed-=e.amount;const released=Math.max(0,obligation.reserve-obligation.owed);obligation.reserve-=released;receivables[e.sharedExpenseId!]-=e.amount;const purchase=b.entries.find(x=>(x.kind==='expense'||x.kind==='shared_claim')&&x.sharedExpenseId===e.sharedExpenseId)!;const card=cards[purchase.accountId!];const funding=card?Math.min(released,Math.max(0,-balances[purchase.accountId!]-card.reserve)):0;if(funding)moveBucket('card:'+purchase.accountId!,funding,false);ready+=released-funding;continue;}
  if(e.kind==='shared_charge'||e.kind==='shared_return'){
   const cat=cats[e.categoryId!];let funded=e.kind==='shared_return'?0:Math.min(e.amount,Math.max(0,cat.cash));cat.cash-=funded;
   const shortfall=Object.values(cats).reduce((n,c)=>n+Math.max(0,-c.cash),0)+Object.values(cards).reduce((n,c)=>n+Math.max(0,-c.reserve),0);
   const extra=Math.min(e.amount-funded,Math.max(0,ready-shortfall));ready-=extra;if(inMonth)cat.assigned+=extra;
   if(e.kind==='shared_return'){funded=Math.min(e.amount-extra,Math.max(0,cat.cash));cat.cash-=funded;}
   obligations[e.sharedShareId!]={categoryId:e.categoryId!,owed:e.amount,reserve:funded+extra};
   if(inMonth&&e.kind==='shared_charge'){cat.spent+=e.amount;spent+=e.amount;}continue;
  }
  const account=b.accounts.find(a=>a.id===e.accountId)!;
  if(e.kind==='shared_payment'){
   const obligation=obligations[e.sharedShareId!],funded=Math.min(e.amount,obligation.reserve);obligation.owed-=e.amount;obligation.reserve-=funded;cats[obligation.categoryId].cash-=e.amount-funded;balances[account.id]-=e.amount;continue;
  }
  if(e.kind==='shared_receipt'){
   receivables[e.sharedExpenseId!]-=e.amount;balances[account.id]+=e.amount;
   const purchase=b.entries.find(p=>(p.kind==='expense'||p.kind==='shared_claim')&&p.sharedExpenseId===e.sharedExpenseId)!;
   if(purchase.kind==='shared_claim'){moveBucket(purchase.categoryId!,e.amount,false);continue;}
   const card=cards[purchase.accountId!];
   const funding=card?Math.min(e.amount,Math.max(0,-balances[purchase.accountId!]-card.reserve)):0;
   if(funding)moveBucket('card:'+purchase.accountId!,funding,false);ready+=e.amount-funding;continue;
  }
  if(e.kind==='shared_refund'){
   const personal=e.amount-e.sharedAmount!,parts=sharedRefundCategoryParts(b,e);receivables[e.sharedExpenseId!]-=e.sharedReduction!;
   if(inMonth){for(const part of parts)cats[part.categoryId].spent-=part.amount;spent-=personal;}
   if(account.type!=='credit'){for(const part of parts)if(part.amount)moveBucket(part.categoryId,part.amount,false);ready+=e.sharedAmount!;}
   else {
    let remaining=e.amount,releasedShared=0;const releasedPersonal:Record<string,number>=Object.create(null);
    for(const portion of [...parts.map(p=>({...p,fronted:false})),{categoryId:'',amount:e.sharedAmount!,fronted:true}]){
     let part=portion.amount;for(const lot of lots){if(lot.accountId!==account.id||lot.entryId!==e.refundOf||(portion.fronted?!!lot.categoryId:lot.categoryId!==portion.categoryId))continue;
      const reversed=Math.min(part,lot.remaining),backing=Math.min(reversed,lot.backed);lot.remaining-=reversed;lot.backed-=backing;part-=reversed;remaining-=reversed;
      if(portion.fronted)releasedShared+=backing;else releasedPersonal[portion.categoryId]=(releasedPersonal[portion.categoryId]??0)+backing;
     }
    }
    for(const lot of lots){if(lot.accountId!==account.id)continue;const reversed=Math.min(remaining,lot.remaining);lot.remaining-=reversed;lot.backed-=Math.min(reversed,lot.backed);remaining-=reversed;}
    cards[account.id].reserve-=Object.values(releasedPersonal).reduce((n,v)=>n+v,0)+releasedShared;
    for(const [categoryId,value]of Object.entries(releasedPersonal))if(value)moveBucket(categoryId,value,false);ready+=releasedShared;
   }
   balances[account.id]+=e.amount;continue;
  }
  if(e.kind==='income'){balances[account.id]+=e.amount;ready+=e.amount;if(inMonth)income+=e.amount;}
  if(e.kind==='expense'){
   const parts=personalCategoryParts(e);
   if(e.sharedExpenseId)receivables[e.sharedExpenseId]=e.sharedAmount??0;
   let creditRemaining=Math.max(0,balances[account.id]);
   for(const part of parts){
    const cat=cats[part.categoryId];
    if(inMonth){cat.spent+=part.amount;spent+=part.amount;}
    if(account.type==='credit'){
     const creditUsed=Math.min(part.amount,creditRemaining);creditRemaining-=creditUsed;
     const newDebt=part.amount-creditUsed,funded=Math.min(newDebt,Math.max(0,cat.cash));
     cat.cash-=funded;cards[account.id].reserve+=funded;
     if(newDebt)lots.push({entryId:e.id,accountId:account.id,categoryId:part.categoryId,remaining:newDebt,backed:funded});
    }else cat.cash-=part.amount;
   }
   if(account.type==='credit'){
    const frontedDebt=Math.max(0,(e.sharedAmount??0)-creditRemaining);
    if(frontedDebt){
     const shortfall=Object.values(cats).reduce((n,c)=>n+Math.max(0,-c.cash),0)+Object.values(cards).reduce((n,c)=>n+Math.max(0,-c.reserve),0)+Object.values(obligations).reduce((n,o)=>n+Math.max(0,-o.reserve),0);
     const backing=Math.min(frontedDebt,Math.max(0,ready-shortfall));ready-=backing;cards[account.id].reserve+=backing;
     lots.push({entryId:e.id,sharedExpenseId:e.sharedExpenseId,accountId:account.id,remaining:frontedDebt,backed:backing});
    }
   }else ready-=e.sharedAmount??0;
   balances[account.id]-=e.amount;
  }
  if(e.kind==='refund'){
   const cat=cats[e.categoryId!];
   if(inMonth){cat.spent-=e.amount;spent-=e.amount;}
   if(account.type!=='credit')moveBucket(e.categoryId!,e.amount,false);
   else {
    let remaining=e.amount,released=0;
    // Refund the linked debt first. Only backing still held for that purchase returns to its category.
    for(const lot of lots){
     if(lot.accountId!==account.id||lot.entryId!==e.refundOf||lot.categoryId!==e.categoryId)continue;
     const reversed=Math.min(remaining,lot.remaining),backing=Math.min(reversed,lot.backed);
     lot.remaining-=reversed;lot.backed-=backing;remaining-=reversed;released+=backing;
    }
    // A refund after repayment can offset other debt or become restricted issuer credit.
    for(const lot of lots){if(lot.accountId!==account.id)continue;const reversed=Math.min(remaining,lot.remaining);lot.remaining-=reversed;lot.backed-=Math.min(reversed,lot.backed);remaining-=reversed;}
    cards[account.id].reserve-=released;
    if(released)moveBucket(e.categoryId!,released,false);
   }
   balances[account.id]+=e.amount;
  }
  if(e.kind==='adjustment'){
   const delta=e.direction==='in'?e.amount:-e.amount;
   if(isCashAccount(account))ready+=delta;
   else if(account.type==='credit'&&delta<0){const debt=Math.max(0,-(balances[account.id]+delta))-Math.max(0,-balances[account.id]);if(debt)lots.push({entryId:e.id,accountId:account.id,remaining:debt,backed:0});}
   else if(account.type==='credit'){let remaining=delta;for(const lot of lots){if(lot.accountId!==account.id)continue;const reversed=Math.min(remaining,lot.remaining);lot.remaining-=reversed;lot.backed-=Math.min(reversed,lot.backed);remaining-=reversed;}}
   balances[account.id]+=delta;
  }
  if(e.kind==='transfer'||e.kind==='payment'){
   balances[account.id]-=e.amount;balances[e.toAccountId!]+=e.amount;
   if(e.kind==='transfer'){
    const destination=b.accounts.find(a=>a.id===e.toAccountId)!;
    // Only the part crossing the budget boundary changes money available to plan.
    ready+=(isCashAccount(destination)?e.amount:0)-(isCashAccount(account)?e.amount:0);
   }
   if(e.kind==='payment'){
    const card=cards[e.toAccountId!];card.reserve-=e.amount;let payment=e.amount;
    for(const lot of lots){if(lot.accountId!==e.toAccountId)continue;const paid=Math.min(payment,lot.remaining);lot.remaining-=paid;lot.backed-=Math.min(paid,lot.backed);payment-=paid;}
    const backed=lots.filter(l=>l.accountId===e.toAccountId).reduce((sum,l)=>sum+l.backed,0);
    unback(e.toAccountId!,Math.max(0,backed-Math.max(0,card.reserve)));
    const statement=b.accounts.find(a=>a.id===e.toAccountId)?.statement;
    if(statement&&e.date>statement.closed){card.statementRemaining=Math.max(0,card.statementRemaining-e.amount);card.minimumRemaining=Math.max(0,card.minimumRemaining-e.amount);}
   }
  }
 }
 if(!captured)captureCarry();
 for(const [key,cat]of Object.entries(cats)){cat.unfunded=lots.filter(l=>l.categoryId===key).reduce((sum,l)=>sum+l.remaining-l.backed,0)+Object.values(obligations).filter(o=>o.categoryId===key).reduce((n,o)=>n+Math.max(0,o.owed-Math.max(0,o.reserve)),0);cat.available=cat.cash-cat.unfunded;}
 for(const [key,card]of Object.entries(cards)){card.owed=Math.max(0,-balances[key]);card.credit=Math.max(0,balances[key]);card.unbacked=Math.max(0,card.owed-Math.max(0,card.reserve));card.statementGap=Math.max(0,card.statementRemaining-card.reserve);}
 const cash=b.accounts.filter(isCashAccount).reduce((sum,a)=>sum+balances[a.id],0);
 // Cash already spent outside a funded category (or payment reserve) cannot be planned again.
 // Keep the signed ledger total separately so assigning that past spending remains explicit.
 const cashShortfall=Object.values(cats).reduce((sum,cat)=>sum+Math.max(0,-cat.cash),0)+Object.values(cards).reduce((sum,card)=>sum+Math.max(0,-card.reserve),0)+Object.values(obligations).reduce((n,o)=>n+Math.max(0,-o.reserve),0);
 const shared={receivable:Object.values(receivables).reduce((n,a)=>n+a,0),owed:Object.values(obligations).reduce((n,o)=>n+o.owed,0),reserved:Object.values(obligations).reduce((n,o)=>n+Math.max(0,o.reserve),0),unfunded:Object.values(obligations).reduce((n,o)=>n+Math.max(0,o.owed-Math.max(0,o.reserve)),0),receivables,obligations};
 return {shared,cash,ready:ready-cashShortfall,unassignedBeforeShortfalls:ready,cashShortfall,balances,categories:cats,cards,netWorth:Object.values(balances).reduce((a,v)=>a+v,0)+shared.receivable-shared.owed,spent,income,transactions:ordered.map(e=>e.entry).filter(e=>e.kind!=='allocation'&&e.date>=start).reverse()};
}
export function bucketAvailable(t:Totals,bucket:string){return bucket==='ready'?t.ready:bucket.startsWith('card:')?t.cards[bucket.slice(5)].reserve:t.categories[bucket].cash;}
export function allocationCapacity(t:Totals,from:string,to:string){
 // Applying unassigned cash to an existing cash shortfall does not spend it a second time.
 const alreadySpent=from==='ready'&&to!=='ready'?Math.max(0,-bucketAvailable(t,to)):0;
 return Math.max(0,bucketAvailable(t,from)+alreadySpent);
}
export function allocate(b:Budget,from:string,to:string,amount:number,date:string):Budget{
 if(amount<=0||!Number.isSafeInteger(amount))throw new Error('Enter a positive amount.');
 if(!['ready',...b.categories.map(c=>c.id),...b.accounts.filter(a=>a.type==='credit').map(a=>'card:'+a.id)].includes(from)||!['ready',...b.categories.map(c=>c.id),...b.accounts.filter(a=>a.type==='credit').map(a=>'card:'+a.id)].includes(to))throw new Error('Choose existing categories or card cash.');
 if(from===to)throw new Error('Choose two different places for this money.');
 const t=calculate(b,date.slice(0,7));
 if(allocationCapacity(t,from,to)<amount)throw new Error('There is not enough money in that source. Choose another source or a smaller amount.');
 const entry:Entry={id:id(),kind:'allocation',from,to,amount,date,payee:'Money moved',note:'',cleared:true};
 return validateBudget({...b,entries:[...b.entries,entry]});
}
export function targetNeed(c:Category,t:CategoryTotal,month=thisMonth()){
 if(c.target<=0||c.targetPausedMonths?.includes(month))return 0;
 if(c.targetType==='capped')return Math.min(Math.max(0,c.target-t.assigned),Math.max(0,(c.targetCap??0)-t.available));
 if(c.targetType==='monthly')return Math.max(0,c.target-t.assigned);
 const gap=Math.max(0,c.target-t.available);
 if(!c.targetDate||c.targetDate.slice(0,7)<=month)return gap;
 const index=(value:string)=>Number(value.slice(0,4))*12+Number(value.slice(5,7))-1;
 const dueMonth=c.targetDate.slice(0,7);
 const paused=new Set((c.targetPausedMonths??[]).filter(m=>m>=month&&m<=dueMonth));
 const months=Math.max(1,index(dueMonth)-index(month)+1-paused.size);
 // Include this month's assignments before calculating its pace, then deduct them once.
 // This keeps a partial allocation from lowering the original monthly contribution.
 return Math.min(gap,Math.max(0,Math.ceil((c.target-t.available+t.assigned)/months)-t.assigned));
}

export function blankBudget(currency:Budget['currency']='USD'):Budget{return {version:1,name:'My budget',currency,demo:false,accounts:[],categories:[
{id:'rent',name:'Rent & home',group:'Everyday essentials',icon:'home',target:0,targetType:'monthly',color:'sand'},
{id:'groceries',name:'Groceries',group:'Everyday essentials',icon:'basket',target:0,targetType:'monthly',color:'sage'},
{id:'dining',name:'Dining out',group:'Life & little joys',icon:'coffee',target:0,targetType:'monthly',color:'peach'},
{id:'emergency',name:'Rainy day fund',group:'Looking ahead',icon:'umbrella',target:0,targetType:'balance',color:'lavender'}],entries:[]};}

export function demoBudget():Budget{
 const month=thisMonth(),date=month+'-01',day=(n:number)=>month+'-'+String(n).padStart(2,'0');
 const previousMonth=new Date(Number(month.slice(0,4)),Number(month.slice(5,7))-1,0);const closed=`${previousMonth.getFullYear()}-${String(previousMonth.getMonth()+1).padStart(2,'0')}-${previousMonth.getDate()}`;
 const b:Budget={version:1,name:'My everyday budget',currency:'USD',demo:true,accounts:[
 {id:'checking',name:'Everyday checking',type:'checking',opening:580000,date,lastFour:'2408'},
 {id:'savings',name:'High-yield savings',type:'savings',opening:650000,date,lastFour:'8910'},
 {id:'visa',name:'Everyday Visa',type:'credit',opening:-82000,date,lastFour:'4829',statement:{amount:82000,minimum:3500,closed,due:day(20)}}
 ],categories:[
 {id:'rent',name:'Rent & home',group:'Everyday essentials',icon:'home',target:185000,targetType:'monthly',color:'sand'},
 {id:'groceries',name:'Groceries',group:'Everyday essentials',icon:'basket',target:60000,targetType:'monthly',color:'sage'},
 {id:'transport',name:'Getting around',group:'Everyday essentials',icon:'car',target:16000,targetType:'monthly',color:'blue'},
 {id:'utilities',name:'Utilities & internet',group:'Everyday essentials',icon:'zap',target:24000,targetType:'monthly',color:'butter'},
 {id:'subscriptions',name:'Subscriptions',group:'Everyday essentials',icon:'repeat',target:6500,targetType:'monthly',color:'lavender'},
 {id:'dining',name:'Dining & coffee',group:'Life & little joys',icon:'coffee',target:22000,targetType:'monthly',color:'peach'},
 {id:'wellness',name:'Health & wellbeing',group:'Life & little joys',icon:'heart',target:10000,targetType:'monthly',color:'rose'},
 {id:'fun',name:'Just for fun',group:'Life & little joys',icon:'sparkles',target:12000,targetType:'monthly',color:'butter'},
 {id:'emergency',name:'Rainy day fund',group:'Looking ahead',icon:'umbrella',target:600000,targetType:'balance',color:'sage'},
 {id:'holiday',name:'A little getaway',group:'Looking ahead',icon:'plane',target:200000,targetType:'balance',color:'blue'},
 {id:'laptop',name:'Next laptop',group:'Looking ahead',icon:'laptop',target:140000,targetType:'balance',color:'lavender'}
 ],entries:[]};
 const amounts:Record<string,number>={rent:185000,groceries:60000,transport:16000,utilities:22000,subscriptions:6500,dining:18000,wellness:10000,fun:12000,emergency:500000,holiday:120000,laptop:45000,'card:visa':30000};
 for(const [to,amount]of Object.entries(amounts))b.entries.push({id:id(),date,kind:'allocation',from:'ready',to,amount,payee:'Monthly plan',note:'',cleared:true});
 const purchases:Array<[number,string,string,string,number]>=[[1,'Greenview Apartments','checking','rent',185000],[2,'Whole Foods Market','visa','groceries',18450],[3,'Blue Bottle Coffee','visa','dining',4280],[3,'City Transit','visa','transport',5240],[4,'Spotify','visa','subscriptions',1199],[4,'The Corner Table','checking','dining',2800],[5,'Trader Joe’s','checking','groceries',7320],[5,'Local Pharmacy','checking','wellness',3500],[6,'Netflix','visa','subscriptions',1499],[6,'Sunday Bookshop','visa','fun',2250]];
 for(const [d,payee,accountId,categoryId,amount]of purchases)b.entries.push({id:id(),date:day(d),kind:'expense',accountId,categoryId,amount,payee,note:'',cleared:true});
 return b;
}
