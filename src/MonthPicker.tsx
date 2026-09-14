import {useEffect,useId,useRef,useState} from 'react';
import type {KeyboardEvent} from 'react';
import {ChevronDown,ChevronLeft,ChevronRight,X} from 'lucide-react';
import {thisMonth} from './engine';
import './month-picker.css';

const names=['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function MonthPicker({value,onChange}:{value:string;onChange:(value:string)=>void}){
 const id=useId(),trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
 const [open,setOpen]=useState(false),[yearText,setYearText]=useState(value.slice(0,4));
 const [position,setPosition]=useState({left:16,top:16});
 const year=Number(yearText),validYear=/^\d{4}$/.test(yearText)&&year>=1900&&year<=9999;
 const current=thisMonth();
 const selectedIndex=Number(value.slice(5))-1;
 const place=()=>{const rect=trigger.current?.getBoundingClientRect();if(!rect)return;const width=Math.min(304,window.innerWidth-24),height=panel.current?.offsetHeight||310;setPosition({left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),top:rect.bottom+height+8<window.innerHeight?rect.bottom+8:Math.max(12,rect.top-height-8)});};
 useEffect(()=>{
  if(!open)return;
  place();
  const focus=requestAnimationFrame(()=>panel.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus());
  const dismiss=(event:Event)=>{if(event.target instanceof Node&&panel.current?.contains(event.target))return;panel.current?.hidePopover();};
  window.addEventListener('resize',place);window.addEventListener('scroll',dismiss,true);
  return()=>{cancelAnimationFrame(focus);window.removeEventListener('resize',place);window.removeEventListener('scroll',dismiss,true);};
 },[open]);
 function select(month:string){onChange(month);panel.current?.hidePopover();trigger.current?.focus();}
 function moveFocus(event:KeyboardEvent<HTMLButtonElement>,index:number){
  const offsets:Record<string,number>={ArrowLeft:-1,ArrowRight:1,ArrowUp:-4,ArrowDown:4,PageUp:-12,PageDown:12};
  let next=event.key==='Home'?0:event.key==='End'?11:index+(offsets[event.key]??0);
  if(!(event.key in offsets)&&event.key!=='Home'&&event.key!=='End')return;
  event.preventDefault();
  let nextYear=year;
  if(next<0){next+=12;nextYear--;}if(next>11){next-=12;nextYear++;}
  if(nextYear<1900||nextYear>9999)return;
  setYearText(String(nextYear));requestAnimationFrame(()=>panel.current?.querySelector<HTMLButtonElement>(`[data-month="${next}"]`)?.focus());
 }
 return <>
  <button ref={trigger} type="button" className="budget-month-trigger" popoverTarget={id} aria-label="Budget month" aria-haspopup="dialog" aria-expanded={open} onClick={()=>{if(!open){setYearText(value.slice(0,4));place();}}}><span>{names[selectedIndex]} {value.slice(0,4)}</span><ChevronDown size={14}/></button>
  <div ref={panel} id={id} popover="auto" role="dialog" aria-label="Choose budget month" className="budget-month-popover" onKeyDown={event=>event.stopPropagation()} style={position} onToggle={event=>setOpen((event.nativeEvent as ToggleEvent).newState==='open')}>
   <div className="budget-month-heading"><span>Choose a month</span><button type="button" className="month-picker-icon" aria-label="Close month picker" onClick={()=>{panel.current?.hidePopover();trigger.current?.focus();}}><X size={16}/></button></div>
   <div className="budget-month-year"><button type="button" className="month-picker-icon" aria-label="Previous year" disabled={!validYear||year===1900} onClick={()=>setYearText(String(year-1))}><ChevronLeft size={17}/></button><input type="text" inputMode="numeric" maxLength={4} aria-label="Year" aria-invalid={!validYear} value={yearText} onFocus={event=>event.target.select()} onChange={event=>setYearText(event.target.value)}/><button type="button" className="month-picker-icon" aria-label="Next year" disabled={!validYear||year===9999} onClick={()=>setYearText(String(year+1))}><ChevronRight size={17}/></button></div>
   <div className="budget-month-grid" role="group" aria-label="Months">{names.map((name,index)=>{const month=`${yearText}-${String(index+1).padStart(2,'0')}`;return <button type="button" key={name} data-month={index} disabled={!validYear} aria-label={`${name} ${yearText}`} aria-pressed={value===month} aria-current={current===month?'date':undefined} onKeyDown={event=>moveFocus(event,index)} onClick={()=>select(month)}>{name.slice(0,3)}{current===month&&<i aria-hidden="true"/>}</button>;})}</div>
   {!validYear&&<p className="month-picker-error" role="status">Enter a year from 1900 to 9999.</p>}
   <div className="budget-month-footer"><span>A dot marks this month</span><button type="button" onClick={()=>select(current)}>Go to current month</button></div>
  </div>
 </>;
}

