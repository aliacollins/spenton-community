import NumberInput from './NumberInput';
import AmountInput from './AmountInput';
import DatePicker from './DatePicker';
import { useState } from 'react';
import { cents, money, targetNeed } from './engine';
import type { Budget, Category, CategoryTotal } from './engine';
import { goalDateAfterMonths } from './targets';
import { Field, Progress } from './ui';
import './goal-editor.css';

export function TargetFields({category,month,currency,totals}:{category?:Category;month:string;currency:Budget['currency'];totals?:CategoryTotal}){
 const [type,setType]=useState<Category['targetType']>(category?.target?category.targetType:'balance');
 const [paused,setPaused]=useState(category?.targetPausedMonths?.includes(month)??false);
 const [amount,setAmount]=useState(category?.target?String(category.target/100):'');
 const [timeline,setTimeline]=useState<'months'|'date'>(category?.target?'date':'months');
 const [months,setMonths]=useState('12');
 const [date,setDate]=useState(category?.targetDate??'');
 const monthName=new Date(month+'-01T12:00:00').toLocaleDateString('en-US',{month:'long',year:'numeric'});
 const dueDate=timeline==='months'?goalDateAfterMonths(month,months):date;
 let goal=0;
 try{goal=cents(amount);}catch{/* Keep incomplete input editable. */}
 const current=totals??{cash:0,available:0,unfunded:0,assigned:0,spent:0,carry:0};
 const pausedMonths=new Set(category?.targetPausedMonths??[]);
 if(paused)pausedMonths.add(month);else pausedMonths.delete(month);
 const draft:Category={id:category?.id??'preview',name:'Savings goal',group:'',icon:'target',color:'sage',target:goal,targetType:'balance',targetDate:dueDate||undefined,targetPausedMonths:[...pausedMonths]};
 const need=targetNeed(draft,current,month);
 const validTimeline=timeline==='date'||!!dueDate;
 return <div className="goal-fields">
  <div className="goal-kind" role="group" aria-label="What would you like to plan?">{([{value:'balance',title:'Savings goal',detail:'Build toward an amount'},{value:'monthly',title:'Every month',detail:'Set a regular contribution'},{value:'capped',title:'With a limit',detail:'Save up to a limit'}] as const).map(option=><button type="button" key={option.value} aria-pressed={type===option.value} onClick={()=>setType(option.value)}><strong>{option.title}</strong><small>{option.detail}</small></button>)}</div>
  <input type="hidden" name="targetType" value={type}/>
  <div className={'goal-amounts '+(type==='capped'?'has-cap':'')}><Field label={type==='balance'?'I want to save':'Set aside each month'}><div className="amount-input goal-amount"><span>{currency}</span><AmountInput name="target" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} aria-label="Goal amount" placeholder="0.00" onFocus={e=>e.currentTarget.select()}/></div></Field>
  {type==='capped'&&<Field label="Stop at this balance"><div className="amount-input"><span>{currency}</span><AmountInput name="targetCap" inputMode="decimal" defaultValue={category?.targetCap!==undefined?String(category.targetCap/100):''} placeholder="1500.00" aria-label="Goal balance limit" required/></div></Field>}</div>
  {type==='balance'&&<>
   <div className="goal-timing"><div><span className="goal-label">Choose a timeline</span><div className="goal-timeline-choice" role="group" aria-label="Goal timeline"><button type="button" aria-pressed={timeline==='months'} onClick={()=>setTimeline('months')}>Over time</button><button type="button" aria-pressed={timeline==='date'} onClick={()=>setTimeline('date')}>By a date</button></div></div>
   {timeline==='months'?<Field label="Number of months"><NumberInput label="Months to save" min="1" max="600" step="1" value={months} onChange={e=>setMonths(e.target.value)} aria-label="Months to save" required/></Field>:<Field label="Goal date"><DatePicker value={date} onChange={setDate} aria-label="Goal date"/></Field>}</div>
   <p className="goal-timing-note">{timeline==='months'?`Starts with ${monthName}. This month counts toward your timeline.`:'Leave the date empty to save at your own pace.'}</p>
   <input name="targetDate" type="hidden" value={dueDate}/>
   {goal>0&&validTimeline&&<div className="savings-goal-preview goal-preview" role="status"><span>Your savings plan</span><strong>{paused?'Paused this month':current.available>=goal?'You’ve reached this goal':need===0?'This month’s contribution is covered':`${money(need,currency)} ${current.assigned>0?'more ':''}to set aside this month`}</strong><Progress value={100*Math.max(0,current.available)/goal} label="Saved toward this goal"/><div className="goal-preview-facts"><div><small>Available now</small><b>{money(Math.max(0,current.available),currency)}</b></div><div><small>Still to save</small><b>{money(Math.max(0,goal-current.available),currency)}</b></div><div><small>Goal date</small><b>{dueDate?new Date(dueDate+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'Your own pace'}</b></div></div></div>}
  </>}
  <input name="targetMonth" type="hidden" value={month}/>
  <div className="goal-options"><label className="check-label"><input type="checkbox" name="targetPaused" checked={paused} onChange={e=>setPaused(e.target.checked)}/><span>Pause for {monthName}</span></label><details><summary>How it works</summary><p>{paused?`No amount is suggested in ${monthName}. Your money stays available. The goal resumes next month unless paused again.`:type==='capped'?'Contribute each month until your balance reaches the limit. After spending, contributions resume.':type==='balance'?'We divide the amount still needed across the remaining months, including this month. Money already assigned counts toward this month’s contribution; paused months are excluded.':'Suggest the same contribution each month. Money left over carries forward.'} Enter 0 in the amount to remove the goal.</p></details></div>
  <p className="goal-save-note">Saving the goal does not set money aside. Use Plan your money to do that.</p>
 </div>;
}

