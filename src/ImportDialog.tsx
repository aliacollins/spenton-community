import Select from './Select';
import { useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, Check, Download, FileText, Upload } from 'lucide-react';
import type { Props } from './Dialogs';
import { money, today, validateBudget } from './engine';
import { download } from './storage';
import { Field, Hint, Modal } from './ui';
import { parseCSV, reviewCSV, suggestMapping } from './csv';
import type { CSVDateFormat, CSVField, CSVMapping, ImportRow } from './csv';
import './import-dialog.css';

export default function ImportDialog({b,onClose,commit}:Props){
 const importAccounts=b.accounts.filter(a=>a.type!=='investment');
 const [account,setAccount]=useState(importAccounts[0]?.id??'');
 const [category,setCategory]=useState(b.categories[0]?.id??'');
 const [text,setText]=useState('');
 const [mapping,setMapping]=useState<CSVMapping|null>(null);
 const [amountMode,setAmountMode]=useState<'signed'|'separate'|null>(null);
 const [dateFormat,setDateFormat]=useState<CSVDateFormat>('iso');
 const [rows,setRows]=useState<ImportRow[]|null>(null);
 const [selected,setSelected]=useState<Set<number>>(new Set());
 const [error,setError]=useState('');
 const source=useMemo(()=>{try{return {rows:parseCSV(text),error:''};}catch(e){return {rows:[] as string[][],error:e instanceof Error?e.message:'Could not read CSV.'};}},[text]);
 const header=source.rows[0]??[];
 const columns=mapping??suggestMapping(header);
 const mode=amountMode??(columns.amount===undefined&&(columns.inflow!==undefined||columns.outflow!==undefined)?'separate':'signed');
 const sample='Date,Payee,Amount,Category,Note\n'+today()+',Neighborhood market,-24.50,"'+(b.categories[0]?.name??'Groceries').replace(/"/g,'""')+'",Weekly shop\n';
 function changeText(value:string){setText(value);setMapping(null);setAmountMode(null);setError('');}
 function review(){
  try{
   if(!account)throw new Error('Add an account first.');
   const result=reviewCSV(text,b,account,category,{mapping:columns,dateFormat,amountMode:mode});
   setRows(result);setSelected(new Set(result.flatMap((row,index)=>!row.duplicate&&!row.error?[index]:[])));setError('');
  }catch(e){setError(e instanceof Error?e.message:'Could not read CSV.');}
 }
 function column(field:CSVField,label:string,optional=false){
  return <Field label={label}><Select aria-label={label} value={columns[field]??''} onChange={e=>setMapping({...columns,[field]:e.target.value===''?undefined:Number(e.target.value)})}><option value="">{optional?'Not in file':'Choose a column'}</option>{header.map((name,index)=><option key={index} value={index}>{name||'Unnamed column'} (column {index+1})</option>)}</Select></Field>;
 }
 const invalid=rows?.filter(row=>row.error).length??0;
 const duplicates=rows?.filter(row=>row.duplicate).length??0;
 return <Modal title={rows?'Review transactions':'Import transactions'} eyebrow="CSV IMPORT · NO BANK CONNECTION" wide onClose={onClose}><div className="form-body">
  {!rows?<><p className="muted">Choose a CSV file, match its columns, then review the transactions before importing.</p>
   <div className="field-row"><Field label="Import into account"><Select value={account} onChange={e=>setAccount(e.target.value)}>{importAccounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field><Field label="Default category"><Select value={category} onChange={e=>setCategory(e.target.value)}>{b.categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field></div>
   <label className="drop-area"><Upload size={25}/><strong>Choose a CSV file</strong><span>Up to 2 MB · 2,000 transactions</span><input type="file" accept=".csv,text/csv" onChange={async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{if(file.size>2_000_000)throw new Error('Use a CSV smaller than 2 MB.');changeText(await file.text());}catch(err){setError(err instanceof Error?err.message:'Could not read this file.');}
   }}/></label>
   <Field label="Or paste CSV"><textarea value={text} onChange={e=>changeText(e.target.value)} rows={5} placeholder={sample}/></Field>
   <button type="button" className="text-button" onClick={()=>download(sample,'spenton-import-example.csv','text/csv')}><Download size={14}/>Download an example</button>
   {header.length>0&&<section aria-label="CSV column mapping" style={{display:'grid',gap:14}}><h3>Match your columns</h3><p className="small muted">Suggestions use your header names. Check the date order and amount direction against your bank export.</p>
    <div className="field-row"><Field label="Amount format"><Select value={mode} onChange={e=>setAmountMode(e.target.value as 'signed'|'separate')}><option value="signed">One signed Amount column</option><option value="separate">Separate Inflow and Outflow</option></Select></Field><Field label="Date format"><Select value={dateFormat} onChange={e=>setDateFormat(e.target.value as CSVDateFormat)}><option value="iso">YYYY-MM-DD</option><option value="mdy">MM/DD/YYYY (month first)</option><option value="dmy">DD/MM/YYYY (day first)</option></Select></Field></div>
    <div className="field-row">{column('date','Date column')}{column('payee','Payee column')}</div>
    {mode==='signed'?column('amount','Amount column'):<div className="field-row">{column('inflow','Inflow column',true)}{column('outflow','Outflow column',true)}</div>}
    <div className="field-row">{column('category','Category column',true)}{column('note','Note column',true)}</div>
    <Hint>{mode==='signed'?'Negative amounts and parentheses are expenses; positive amounts are income.':'Use positive amounts in separate columns. The Outflow column becomes spending; Inflow becomes income.'} Use a decimal point for cents. Slash and dash separators are accepted for day-first and month-first dates.</Hint>
    {source.rows.length>1&&<details><summary>Preview source rows ({source.rows.length-1} total)</summary><div style={{overflowX:'auto',maxWidth:'100%'}}><table style={{width:'100%',fontSize:12,textAlign:'left'}}><thead><tr>{header.map((name,index)=><th key={index} style={{padding:8}}>{name||'Column '+(index+1)}</th>)}</tr></thead><tbody>{source.rows.slice(1,4).map((row,index)=><tr key={index}>{row.map((value,col)=><td key={col} style={{padding:8,maxWidth:240,overflowWrap:'anywhere'}}>{value||'Empty'}</td>)}</tr>)}</tbody></table></div></details>}
   </section>}
   {source.error&&!error&&<p role="alert" className="form-error">{source.error}</p>}
  </>:<><div className="import-summary"><FileText size={20}/><span><strong>{selected.size} transactions selected</strong><small>Possible duplicates are unchecked. Two purchases with the same details can still be real. Review before importing.</small></span></div>
   <p className="small muted">{rows.length} rows reviewed · {invalid} invalid · {duplicates} possible duplicates. Invalid rows cannot be imported.</p>
   <div className="button-row"><button type="button" className="text-button" onClick={()=>setSelected(new Set(rows.flatMap((row,index)=>!row.error&&!row.duplicate?[index]:[])))}>Select valid, non-duplicate rows</button><button type="button" className="text-button" onClick={()=>setSelected(new Set())}>Deselect all</button></div>
   <div className="import-review">{rows.map((row,index)=><label key={index} className={'import-row '+(row.error?'invalid':'')}><input type="checkbox" aria-label={'Import row '+row.line+': '+row.entry.payee} disabled={!!row.error} checked={selected.has(index)} onChange={e=>setSelected(previous=>{const next=new Set(previous);if(e.target.checked)next.add(index);else next.delete(index);return next;})}/><span><strong>{row.entry.payee||'Row '+row.line}</strong><small>{row.error?'Row '+row.line+': '+row.error:(row.duplicate?'Possible duplicate · ':'')+row.entry.date+(row.entry.categoryId?' · '+b.categories.find(c=>c.id===row.entry.categoryId)?.name:' · Income')}</small></span><strong>{row.error?'Invalid':money(row.entry.amount*(row.entry.kind==='expense'?-1:1),b.currency)}</strong>{row.error&&<AlertCircle size={16}/>}</label>)}</div>
  </>}
  {error&&<p role="alert" className="form-error">{error}</p>}
 </div><div className="modal-footer"><button className="button ghost" onClick={()=>{setError('');if(rows)setRows(null);else onClose();}}>{rows?'Back':'Cancel'}</button><button className="button primary" onClick={()=>{
  if(!rows){review();return;}
  try{
   if(!selected.size)throw new Error('Select at least one transaction.');
   const entries=rows.filter((row,index)=>selected.has(index)&&!row.error).map(row=>row.entry);
   if(entries.some(entry=>entry.date>today()))throw new Error('Remove future transactions from this import.');
   commit(validateBudget({...b,entries:[...b.entries,...entries]}),entries.length+' transactions imported',false,'import.completed');onClose();
  }catch(e){setError(e instanceof Error?e.message:'Import failed.');}
 }}>{rows?<><Check size={16}/>Import selected</>:<>Review transactions <ArrowRight size={16}/></>}</button></div></Modal>;
}
