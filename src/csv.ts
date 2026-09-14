import { cents, id, today } from './engine';
import type { Budget, Entry } from './engine';
export type ImportRow={entry:Entry;duplicate:boolean;error?:string;line:number};
export type CSVField='date'|'payee'|'amount'|'inflow'|'outflow'|'category'|'note';
export type CSVMapping=Partial<Record<CSVField,number>>;
export type CSVDateFormat='iso'|'mdy'|'dmy';
export type CSVOptions={mapping?:CSVMapping;dateFormat?:CSVDateFormat;amountMode?:'signed'|'separate'};

export function suggestMapping(header:string[]):CSVMapping{
 const aliases:Record<CSVField,string[]>={date:['date','transactiondate','posteddate','postingdate'],payee:['payee','description','merchant','name','transactiondescription'],amount:['amount','transactionamount'],inflow:['inflow','credit','credits','deposit','deposits','moneyin'],outflow:['outflow','debit','debits','withdrawal','withdrawals','moneyout'],category:['category'],note:['note','notes','memo']};
 const normalized=header.map(value=>value.toLowerCase().replace(/[^a-z]/g,''));
 return Object.fromEntries(Object.entries(aliases).flatMap(([field,names])=>{const index=normalized.findIndex(value=>names.includes(value));return index<0?[]:[[field,index]];}));
}

export function parseImportAmount(input:string):number{
 let value=input.trim();const parentheses=value.startsWith('(')&&value.endsWith(')');
 if(parentheses)value=value.slice(1,-1).trim();
 value=value.replace(/^([+-]?)\s*[$€£₹]\s*/,'$1').replace(/\s*[$€£₹]$/,'').trim();
 if(parentheses&&/^[+-]/.test(value))throw new Error('Use either parentheses or a minus sign for an expense.');
 if(!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3})(?:\.\d{1,2})?$/.test(value))throw new Error('Use an amount with a decimal point and up to two decimal places.');
 return cents((parentheses?'-':'')+value.replace(/^\+/,''));
}

export function parseImportDate(input:string,format:CSVDateFormat='iso'):string{
 const match=(format==='iso'?/^(\d{4})-(\d{2})-(\d{2})$/:/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/).exec(input.trim());
 const label=format==='iso'?'YYYY-MM-DD':format==='mdy'?'MM/DD/YYYY':'DD/MM/YYYY';
 if(!match)throw new Error('Use a valid '+label+' date.');
 const [year,month,day]=format==='iso'?[Number(match[1]),Number(match[2]),Number(match[3])]:[Number(match[3]),Number(match[format==='mdy'?1:2]),Number(match[format==='mdy'?2:1])];
 const result=`${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
 if(year<1||Number.isNaN(Date.parse(result))||new Date(result+'T12:00:00Z').toISOString().slice(0,10)!==result)throw new Error('Use a valid '+label+' calendar date.');
 return result;
}
export function parseCSV(text:string):string[][]{
 if(text.length>2_000_000)throw new Error('Use a CSV smaller than 2 MB.');
 text=text.replace(/^\uFEFF/,'');
 const rows:string[][]=[];let row:string[]=[];let field='';let quoted=false;let closed=false;
 for(let i=0;i<text.length;i++){const c=text[i];
  if(closed&&c!==','&&c!=='\n'&&c!=='\r'){if(c===' '||c==='\t')continue;throw new Error('Check the CSV quotation marks.');}
  if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else if(!field||quoted){closed=quoted;quoted=!quoted;}else throw new Error('Check the CSV quotation marks.');}
  else if(c===','&&!quoted){row.push(field);field='';closed=false;}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(f=>f.trim()))rows.push(row);row=[];field='';closed=false;}
  else field+=c;
 }
 if(quoted)throw new Error('A quoted field is missing its closing quotation mark.');
 row.push(field);if(row.some(f=>f.trim()))rows.push(row);
 if(rows.length>2001)throw new Error('Import up to 2,000 rows at a time.');
 return rows;
}
export const fingerprint=(e:Entry)=>[e.date,e.kind,e.accountId,e.amount,e.payee.trim().toLowerCase(),e.categoryId??''].join('|');
export function reviewCSV(text:string,b:Budget,accountId:string,fallbackCategory:string,options:CSVOptions={}):ImportRow[]{
 const rows=parseCSV(text.replace(/^\uFEFF/,''));if(rows.length<2)throw new Error('The file needs a header and at least one transaction.');
 const mapping=options.mapping??suggestMapping(rows[0]);
 const mode=options.amountMode??(mapping.amount===undefined?'separate':'signed');
 const active:CSVField[]=['date','payee','category','note',...(mode==='signed'?['amount'] as const:['inflow','outflow'] as const)];
 const columns=active.flatMap(field=>mapping[field]===undefined?[]:[mapping[field]!]);
 if(mapping.date===undefined||mapping.payee===undefined||(mode==='signed'?mapping.amount===undefined:mapping.inflow===undefined&&mapping.outflow===undefined))throw new Error('Map Date, Payee, and Amount, or use separate Inflow and Outflow columns.');
 if(columns.some(index=>!Number.isInteger(index)||index<0||index>=rows[0].length))throw new Error('Choose a valid CSV column for each mapped field.');
 if(new Set(columns).size!==columns.length)throw new Error('Use a different CSV column for each mapped field.');
 const seen=new Set(b.entries.filter(e=>e.kind!=='allocation').map(fingerprint));const account=b.accounts.find(a=>a.id===accountId);
 if(!account)throw new Error('Choose an existing account to import into.');
 return rows.slice(1).map((r,i)=>{
  const value=(name:CSVField)=>mapping[name]===undefined?'':r[mapping[name]!]?.trim()??'';
  const entry:Entry={id:id(),date:value('date'),payee:value('payee'),amount:1,kind:'expense',accountId,categoryId:fallbackCategory,note:value('note'),cleared:true};
  try{
   if(r.length!==rows[0].length)throw new Error('This row has a different number of columns than the header. Quote amounts or descriptions containing commas.');
   let amount:number;
   if(mode==='signed')amount=parseImportAmount(value('amount'));
   else{
    const inflow=value('inflow')?parseImportAmount(value('inflow')):0,outflow=value('outflow')?parseImportAmount(value('outflow')):0;
    if(inflow<0||outflow<0)throw new Error('Separate Inflow and Outflow amounts must be positive; the column sets the direction.');
    if(inflow&&outflow)throw new Error('Only one of Inflow or Outflow can contain a non-zero amount.');
    amount=inflow-outflow;
   }
   if(!amount)throw new Error('Zero amount.');
   entry.amount=Math.abs(amount);entry.kind=amount<0?'expense':'income';
   entry.date=parseImportDate(entry.date,options.dateFormat);
   if(entry.date>today())throw new Error('Future transactions cannot be imported. Add a recurring entry for planned transactions.');
   if(entry.date<account.date)throw new Error('Date is before this account’s opening.');
   if(!entry.payee)throw new Error('Payee is missing.');
   if(entry.payee.length>160)throw new Error('Keep the payee within 160 characters.');
   if(entry.note.length>500)throw new Error('Keep the note within 500 characters.');
   if(amount>0&&account.type==='credit')throw new Error('Card credits need review; use Record payment for repayments.');
   if(entry.kind==='expense'){
    const category=value('category');entry.categoryId=category?b.categories.find(c=>c.name.toLowerCase()===category.toLowerCase())?.id:fallbackCategory;
    if(!b.categories.some(c=>c.id===entry.categoryId))throw new Error('Category not found. Use an existing category name.');
   }else delete entry.categoryId;
   const key=fingerprint(entry);const duplicate=seen.has(key);seen.add(key);entry.importKey=key;
   return {entry,duplicate,line:i+2};
  }catch(error){return {entry,duplicate:false,error:error instanceof Error?error.message:'Invalid row.',line:i+2};}
 });
}
