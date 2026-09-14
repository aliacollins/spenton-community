import { describe,it,expect } from 'vitest';
import { parseCSV,parseImportAmount,parseImportDate,reviewCSV,suggestMapping } from './csv';
import { demoBudget,today } from './engine';
describe('CSV review',()=>{
 it('handles escaped quotes, quoted commas, CRLF and multiline notes',()=>{expect(parseCSV('Date,Payee,Amount,Note\r\n2026-09-07,"Smith, \"\"John\"\"",-12.50,"Line one\nLine two"')).toEqual([['Date','Payee','Amount','Note'],['2026-09-07','Smith, "John"','-12.50','Line one\nLine two']]);});
 it('flags repeated purchases for review instead of silently deleting them',()=>{const b=demoBudget();const date=b.accounts[0].date;const rows=reviewCSV('Date,Payee,Amount\n'+date+',Market,-20\n'+date+',Market,-20',b,'checking','groceries');expect(rows[0].duplicate).toBe(false);expect(rows[1].duplicate).toBe(true);expect(rows).toHaveLength(2);});
 it('rejects invalid dates, precision and unknown categories per row',()=>{const b=demoBudget();const rows=reviewCSV('Date,Payee,Amount,Category\n2026-02-30,Market,-20,Groceries\n2026-09-07,Market,-20.001,Groceries\n2026-09-07,Market,-20,Unknown',b,'checking','groceries');expect(rows.every(r=>r.error)).toBe(true);});
 it('does not import a card repayment as income',()=>{const b=demoBudget();const rows=reviewCSV('Date,Payee,Amount\n'+b.accounts[0].date+',Payment,20',b,'visa','groceries');expect(rows[0].error).toMatch(/Card credits/);});
 it('suggests bank export columns without requiring canonical header names',()=>{expect(suggestMapping(['Posted Date','Description','Debit','Credit','Memo'])).toEqual({date:0,payee:1,outflow:2,inflow:3,note:4});});
 it('maps reordered columns and preserves normalized duplicate review',()=>{
  const b=demoBudget();b.accounts[0].date='2024-01-01';
  const text='Details,Paid,Posted,Extra\nBakery,12.50,02/03/2024,Coffee\nBakery,12.50,02/03/2024,Coffee';
  const options={mapping:{payee:0,outflow:1,date:2,note:3},dateFormat:'dmy' as const,amountMode:'separate' as const};
  const rows=reviewCSV(text,b,'checking','groceries',options);
  expect(rows[0]).toMatchObject({duplicate:false,entry:{date:'2024-03-02',amount:1250,kind:'expense',note:'Coffee',categoryId:'groceries'}});
  expect(rows[1].duplicate).toBe(true);
  expect(reviewCSV(text,{...b,entries:[...b.entries,rows[0].entry]},'checking','groceries',options).every(row=>row.duplicate)).toBe(true);
 });
 it('accepts separate inflow/outflow with blanks and rejects ambiguous direction',()=>{
  const b=demoBudget();const date=b.accounts[0].date;
  const rows=reviewCSV('Date,Description,Credit,Debit\n'+date+',Salary,200,\n'+date+',Shop,,24.50\n'+date+',Both,12,4\n'+date+',Negative,,-12\n'+date+',Empty,,',b,'checking','groceries');
  expect(rows[0]).toMatchObject({entry:{kind:'income',amount:20000}});expect(rows[0].entry.categoryId).toBeUndefined();
  expect(rows[1]).toMatchObject({entry:{kind:'expense',amount:2450}});
  expect(rows[2].error).toMatch(/Only one/);expect(rows[3].error).toMatch(/must be positive/);expect(rows[4].error).toMatch(/Zero/);
 });
 it('validates column selection before reviewing rows',()=>{
  const b=demoBudget(),text='Date,Payee,Amount\n'+b.accounts[0].date+',Shop,-12';
  expect(()=>reviewCSV(text,b,'checking','groceries',{mapping:{date:0,payee:1,amount:1}})).toThrow(/different CSV column/);
  expect(()=>reviewCSV(text,b,'checking','groceries',{mapping:{date:0,payee:1,amount:7}})).toThrow(/valid CSV column/);
  expect(()=>reviewCSV(text,b,'missing','groceries')).toThrow(/existing account/);
 });
 it('reports row width errors, unknown fallback category, and oversized text independently',()=>{
  const b=demoBudget(),date=b.accounts[0].date;
  const rows=reviewCSV('Date,Payee,Amount,Note\n'+date+',Shop,-12\n'+date+',Shop,-12,OK\n'+date+','+'x'.repeat(161)+',-12,OK\n'+date+',Shop,-12,'+'x'.repeat(501),b,'checking','missing');
  expect(rows[0].error).toMatch(/number of columns/);expect(rows[1].error).toMatch(/Category not found/);expect(rows[2].error).toMatch(/160/);expect(rows[3].error).toMatch(/500/);
 });
 it('rejects future actual transactions during review while accepting today',()=>{
  const b=demoBudget(),date=today();const tomorrow=new Date(date+'T12:00:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
  const rows=reviewCSV('Date,Payee,Amount\n'+date+',Shop,-12\n'+tomorrow.toISOString().slice(0,10)+',Shop,-12',b,'checking','groceries');
  expect(rows[0].error).toBeUndefined();expect(rows[1].error).toMatch(/Future transactions/);
 });
 it('accepts a BOM and rejects characters after a closing quote',()=>{
  expect(parseCSV('\uFEFFDate,Payee\n2024-01-01,"Shop"  ')).toEqual([['Date','Payee'],['2024-01-01','Shop']]);
  expect(()=>parseCSV('Date,Payee\n2024-01-01,"Shop"oops')).toThrow(/quotation/);
 });
});

describe('CSV date formats',()=>{
 it('honors the selected date order and accepts both date separators',()=>{
  expect(parseImportDate('02/03/2024','dmy')).toBe('2024-03-02');
  expect(parseImportDate('02-03-2024','mdy')).toBe('2024-02-03');
  expect(parseImportDate('29/02/2024','dmy')).toBe('2024-02-29');
 });
 it('rejects impossible calendar dates rather than normalizing them',()=>{
  expect(()=>parseImportDate('29/02/2025','dmy')).toThrow(/calendar/);
  expect(()=>parseImportDate('04/31/2024','mdy')).toThrow(/calendar/);
  expect(()=>parseImportDate('2024-13-01')).toThrow(/calendar/);
  expect(()=>parseImportDate('12/31/24','mdy')).toThrow(/date/);
 });
});

describe('CSV amount formats',()=>{
 it.each([['-$1,234.50',-123450],['($1,234.50)',-123450],['+24.50',2450],['£-12',-1200],['₹1,00,000.00',10000000],['0',0]])('parses %s into integer cents',(input,expected)=>{expect(parseImportAmount(String(input))).toBe(expected);});
 it.each(['12,34','1.234,56','20.001','(-12)','1e3','NaN','1$2','--12','10000000000.01'])('rejects ambiguous or unsupported amount %s',input=>{expect(()=>parseImportAmount(input)).toThrow();});
});
