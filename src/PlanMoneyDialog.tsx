import AmountInput from './AmountInput';
import {useState} from 'react';
import {allocate,cents,money,monthEnd,targetNeed,thisMonth,today,validateBudget} from './engine';
import {CategoryIcon,Form,Modal} from './ui';
import type {Props} from './Dialogs';
import './plan-money.css';

export default function PlanMoneyDialog({b,t,month,onClose,commit}:Props){
 const fmt=(value:number)=>money(value,b.currency);
 const suggestions=()=>{
  let remaining=Math.max(0,t.ready);
  return Object.fromEntries(b.categories.map(category=>{const proposed=Math.min(remaining,targetNeed(category,t.categories[category.id],month));remaining-=proposed;return [category.id,proposed?String(proposed/100):''];}));
 };
 const [amounts,setAmounts]=useState<Record<string,string>>(suggestions);
 const parsed=b.categories.map(category=>{try{const value=cents(amounts[category.id]?.trim()||'0');return {category,value,valid:value>=0};}catch{return {category,value:0,valid:false};}});
 const invalid=parsed.some(row=>!row.valid);
 const total=parsed.reduce((sum,row)=>sum+(row.valid?row.value:0),0);
 const left=t.ready-total;
 const groups=[...new Set(b.categories.map(category=>category.group))];
 return <Modal guideMessage={invalid?'Check the amount. Your plan changes only when you save.':left<0?'You are planning more than you have. Reduce the amounts below.':left===0?'All your money is planned. Save to confirm. Your bank balance stays the same.':`You are planning ${fmt(total)}, with ${fmt(left)} left. Your bank balance stays the same.`} title="Plan your money" eyebrow="SET CATEGORY AMOUNTS" onClose={onClose} className="modal-standard plan-money-modal"><Form onClose={onClose} label="Save this plan" onSubmit={()=>{
  if(invalid)throw new Error('Check the highlighted amounts. Use a positive amount or zero.');
  if(total<=0)throw new Error('Add an amount to at least one category.');
  if(left<0)throw new Error(`Reduce this plan by ${fmt(-left)} to stay within the money you have.`);
  let next=b;
  for(const {category,value} of parsed)if(value)next=allocate(next,'ready',category.id,value,month===thisMonth()?today():monthEnd(month));
  commit(validateBudget(next),'Your money has a plan');onClose();
 }}>
  <div className={'plan-money-summary'+(left<0?' over-budget':'')}>
   <div className="plan-money-remaining" role="status" aria-live="polite"><span>{invalid?'Check your amounts':left<0?'Over your available money':'Available to plan'}</span><strong>{invalid?'Check amounts':fmt(Math.abs(left))}</strong><small>{invalid?'One or more amounts need a correction.':left<0?'Reduce an amount below before saving.':left===0?'All money is planned.':`Plan it now or later.`}</small></div>
   <dl><div><dt>Available to plan</dt><dd>{fmt(t.ready)}</dd></div><div><dt>Adding to categories</dt><dd>{invalid?'Check amounts':fmt(total)}</dd></div></dl>
  </div>
  <div className="plan-money-tools"><p>Enter amounts to add to each category, then save.</p><div>{t.ready>0&&b.categories.some(category=>targetNeed(category,t.categories[category.id],month)>0)&&<button type="button" onClick={()=>setAmounts(suggestions())}>Use goal suggestions</button>}<button type="button" onClick={()=>setAmounts({})}>Clear amounts</button></div></div>
  <div className="plan-money-groups">
   {groups.map(group=><section className="plan-money-group" key={group} aria-label={group}><div className="plan-money-group-heading"><h3>{group}</h3><span>Add amount · {b.currency}</span></div>
    {parsed.filter(row=>row.category.group===group).map(({category:c,value,valid})=>{
     const current=t.categories[c.id],need=targetNeed(c,current,month);
     return <label className={'plan-money-row'+(valid&&value>0?' has-amount':'')} key={c.id}><CategoryIcon category={c}/><span className="plan-money-category"><strong>{c.name}</strong><small>{fmt(current.available)} available{c.target>0?c.targetPausedMonths?.includes(month)?' · Goal paused':need>0?` · ${fmt(need)} suggested`:' · On track this month':''}</small></span><span className="plan-money-entry"><AmountInput name={c.id} inputMode="decimal" aria-label={'Plan for '+c.name} aria-invalid={!valid} value={amounts[c.id]??''} placeholder="0.00" autoComplete="off" onFocus={event=>event.target.select()} onChange={event=>setAmounts(old=>({...old,[c.id]:event.target.value}))}/>{!valid&&<small>Check amount</small>}</span></label>;
    })}
   </section>)}
   {!groups.length&&<p className="muted">Add a category before planning money.</p>}
  </div>
 </Form></Modal>;
}

