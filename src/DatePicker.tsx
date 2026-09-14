import Select from './Select';
import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import type {InputHTMLAttributes,KeyboardEvent} from 'react';
import {createPortal} from 'react-dom';
import {CalendarDays,ChevronLeft,ChevronRight,X} from 'lucide-react';
import {today} from './engine';
import {calendarDays,dateInputText,displayDate,moveDate,moveMonth,parseDateInput,validDate} from './dates';
import {useDropdown} from './Dropdown';
import './date-picker.css';

type Props=Omit<InputHTMLAttributes<HTMLInputElement>,'type'|'value'|'defaultValue'|'onChange'> & {value?:string;defaultValue?:string;onChange?:(value:string)=>void};
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function DatePicker({value,defaultValue,onChange,min,max,name,onBlur,onFocus,onKeyDown,onInvalid,...props}:Props){
 const [local,setLocal]=useState(defaultValue??today());
 const selected=value??local,current=today();
 const [label,setLabel]=useState(props['aria-label']??'Date');
 const [text,setText]=useState(dateInputText(selected)),[touched,setTouched]=useState(false);
 const accepted=useRef(selected),[view,setView]=useState((validDate(selected)?selected:current).slice(0,7));
 const [yearText,setYearText]=useState(view.slice(0,4)),[open,setOpen]=useState(false),[active,setActive]=useState(selected||current);
 const input=useRef<HTMLInputElement>(null),trigger=useRef<HTMLButtonElement>(null),anchor=useRef<HTMLDivElement>(null),opener=useRef<HTMLElement|null>(null),focusCalendar=useRef(false),popupId=useId();
 const minimum=typeof min==='string'?min:'0001-01-01',maximum=typeof max==='string'?max:'9999-12-31';
 const parsed=parseDateInput(text),validYear=/^\d{4}$/.test(yearText)&&Number(yearText)>0;
 const allowed=(date:string)=>validDate(date)&&date>=minimum&&date<=maximum;
 const error=!text.trim()?props.required?'Choose a date to continue.':'':!parsed?'Enter a complete date, such as '+dateInputText(current)+'.':parsed<minimum?'Choose '+dateInputText(minimum)+' or a later date.':parsed>maximum?'Choose '+dateInputText(maximum)+' or an earlier date.':'';
 const {panel,host,position}=useDropdown(anchor,open,()=>setOpen(false),{minWidth:336,maxWidth:336,maxHeight:510,overlapAnchor:true});
 useLayoutEffect(()=>{
  if(props['aria-label']){setLabel(props['aria-label']);return;}
  const parent=anchor.current?.closest('label');if(!parent)return;
  const range=document.createRange();range.selectNodeContents(parent);range.setEndBefore(anchor.current!);
  const content=range.toString().trim();if(content)setLabel(content);
 });
 useEffect(()=>{if(accepted.current!==selected){accepted.current=selected;setText(dateInputText(selected));setTouched(false);}},[selected]);
 useEffect(()=>setYearText(view.slice(0,4)),[view]);
 useLayoutEffect(()=>{input.current?.setCustomValidity(error);},[error]);
 useEffect(()=>{if(props.disabled||props.readOnly)setOpen(false);},[props.disabled,props.readOnly]);
 useEffect(()=>{
  if(!open||!host||!focusCalendar.current)return;
  const frame=requestAnimationFrame(()=>{panel.current?.querySelector<HTMLButtonElement>('[data-day="'+active+'"]:not(:disabled)')?.focus({preventScroll:true});focusCalendar.current=false;});
  return()=>cancelAnimationFrame(frame);
 },[open,host,active,panel]);
 useEffect(()=>{const form=input.current?.form;if(!form)return;const reset=()=>{if(value===undefined){const date=defaultValue??today();accepted.current=date;setLocal(date);setText(dateInputText(date));}setTouched(false);setOpen(false);};form.addEventListener('reset',reset);return()=>form.removeEventListener('reset',reset);},[value,defaultValue]);
 function change(date:string){accepted.current=date;setLocal(date);onChange?.(date);}
 function close(restore=true){setOpen(false);if(restore)opener.current?.focus({preventScroll:true});}
 function show(source:HTMLElement,moveFocus=true){if(props.disabled||props.readOnly)return;const date=allowed(parsed)?parsed:current<minimum?minimum:current>maximum?maximum:current;opener.current=source;focusCalendar.current=moveFocus;setView(date.slice(0,7));setYearText(date.slice(0,4));setActive(date);setOpen(true);}
 function select(date:string){if(!allowed(date)||!validYear)return;change(date);setText(dateInputText(date));setTouched(false);close();}
 function browse(month:string){setView(month);setActive(calendarDays(month).find(date=>date.startsWith(month)&&allowed(date))??month+'-01');}
 function navigate(event:KeyboardEvent<HTMLButtonElement>,date:string){
  const offsets:Record<string,number>={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
  let next:string;
  if(event.key in offsets)next=moveDate(date,offsets[event.key]);
  else if(event.key==='Home')next=view+'-01';
  else if(event.key==='End')next=moveDate(moveMonth(view,1)+'-01',-1);
  else if(event.key==='PageUp'||event.key==='PageDown')next=moveMonth(view,event.key==='PageUp'?-1:1)+'-01';
  else return;
  event.preventDefault();if(!allowed(next))return;
  setView(next.slice(0,7));setActive(next);
  const day=panel.current?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`);
  if(day)day.focus({preventScroll:true});else requestAnimationFrame(()=>panel.current?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)?.focus({preventScroll:true}));
 }
 return <div className="date-picker">
  <div ref={anchor} className="date-picker-field" data-invalid={touched&&!!error||undefined}>
   {name&&<input type="hidden" name={name} value={parsed} disabled={props.disabled} form={props.form}/>}
   <input {...props} ref={input} type="text" value={text} maxLength={24} placeholder="Choose a date" autoComplete="off" spellCheck={false} aria-label={label} aria-haspopup="dialog" aria-controls={popupId} aria-expanded={open} aria-invalid={touched&&!!error||props['aria-invalid']} aria-describedby={[props['aria-describedby'],popupId+'-hint',touched&&error?popupId+'-error':''].filter(Boolean).join(' ')} onClick={event=>{if(!open)show(event.currentTarget,false);}} onFocus={event=>{event.currentTarget.select();onFocus?.(event);}} onBlur={event=>{setTouched(true);if(parsed)setText(dateInputText(parsed));onBlur?.(event);}} onChange={event=>{const next=event.target.value;setText(next);const date=parseDateInput(next);if(date||!next.trim())change(date);}} onInvalid={event=>{event.preventDefault();setTouched(true);close(false);event.currentTarget.focus({preventScroll:true});onInvalid?.(event);}} onKeyDown={event=>{
    if(event.key==='ArrowDown'){event.preventDefault();event.stopPropagation();show(event.currentTarget);}
    else if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close();}
    else if(event.key==='Enter'&&open){event.preventDefault();event.stopPropagation();if(parsed)setText(dateInputText(parsed));close();}
    else if(event.key==='Tab'&&open)close(false);
    onKeyDown?.(event);
   }}/>
   <button ref={trigger} className="date-picker-trigger" type="button" aria-label={'Choose '+label.toLowerCase()} aria-haspopup="dialog" aria-controls={popupId} aria-expanded={open} disabled={props.disabled||props.readOnly} onClick={event=>open?close():show(event.currentTarget)}><CalendarDays size={19} aria-hidden="true"/></button>
  </div>
  <span id={popupId+'-hint'} className="date-picker-help">Type a date like {dateInputText(current)}, or use the calendar.</span>
  {touched&&error&&<small id={popupId+'-error'} className="date-picker-error" role="alert">{error}</small>}
  {host&&createPortal(<div id={popupId} ref={panel} popover="auto" role="dialog" aria-label={'Choose '+label.toLowerCase()} className="date-picker-popover" style={position} onToggle={event=>{event.stopPropagation();if((event.nativeEvent as ToggleEvent).newState==='closed')setOpen(false);}} onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();close();}}}>
   <div className="date-picker-heading"><div><span>CHOOSE A DATE</span><strong>{allowed(parsed)?dateInputText(parsed):'Find the right day'}</strong></div><button type="button" aria-label="Close date picker" onClick={()=>close()}><X size={18}/></button></div>
   <div className="date-picker-navigation"><button type="button" aria-label="Previous calendar month" disabled={view<=minimum.slice(0,7)} onClick={()=>browse(moveMonth(view,-1))}><ChevronLeft size={18}/></button><Select aria-label="Calendar month" value={view.slice(5)} onChange={event=>browse(view.slice(0,5)+event.target.value)}>{months.map((month,index)=><option key={month} value={String(index+1).padStart(2,'0')}>{month}</option>)}</Select><input aria-label="Calendar year" type="text" inputMode="numeric" maxLength={4} aria-invalid={!validYear} value={yearText} onFocus={event=>event.currentTarget.select()} onChange={event=>{const year=event.target.value;if(!/^\d{0,4}$/.test(year))return;setYearText(year);if(/^\d{4}$/.test(year)&&Number(year)>0)browse(year+view.slice(4));}}/><button type="button" aria-label="Next calendar month" disabled={view>=maximum.slice(0,7)} onClick={()=>browse(moveMonth(view,1))}><ChevronRight size={18}/></button></div>
   {!validYear&&<p className="date-picker-error" role="status">Enter a four-digit year.</p>}
   <div className="date-picker-week" aria-hidden="true">{['Su','Mo','Tu','We','Th','Fr','Sa'].map(day=><span key={day}>{day}</span>)}</div>
   <div className="date-picker-grid" role="group" aria-label={months[Number(view.slice(5))-1]+' '+view.slice(0,4)}>{calendarDays(view).map(date=><button type="button" key={date} data-day={date} tabIndex={active===date?0:-1} className={date.slice(0,7)!==view?'outside-month':''} aria-label={displayDate(date)} aria-pressed={selected===date} aria-current={current===date?'date':undefined} disabled={!validYear||!allowed(date)} onClick={()=>select(date)} onFocus={()=>setActive(date)} onKeyDown={event=>navigate(event,date)}>{Number(date.slice(8))}</button>)}</div>
   <div className="date-picker-footer"><span><i aria-hidden="true"/> Today</span><button type="button" disabled={!allowed(current)} onClick={()=>{setYearText(current.slice(0,4));change(current);setText(dateInputText(current));setTouched(false);close();}}>Today</button></div>
  </div>,host)}
 </div>;
}
