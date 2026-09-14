import {useEffect,useRef,useState} from 'react';
import type {InputHTMLAttributes} from 'react';
import {Minus,Plus} from 'lucide-react';

type Props=Omit<InputHTMLAttributes<HTMLInputElement>,'type'> & {label:string};

// Preserve number-field validity and FormData while owning the visible stepper.
export default function NumberInput({label,value,defaultValue,onChange,disabled,readOnly,min,max,step=1,className='',...props}:Props){
 const input=useRef<HTMLInputElement>(null),[local,setLocal]=useState(String(defaultValue??''));
 const current=String(value??local),number=current.trim()?Number(current):NaN;
 useEffect(()=>{
  const form=input.current?.form;if(!form)return;
  const reset=()=>queueMicrotask(()=>setLocal(input.current?.value??''));
  form.addEventListener('reset',reset);return()=>form.removeEventListener('reset',reset);
 },[]);
 function adjust(direction:number){
  const field=input.current;
  if(!field||field.matches(':disabled')||readOnly)return;
  const before=field.value;
  // The platform's decimal step calculation respects min, max and step bases.
  if(direction>0)field.stepUp();else field.stepDown();
  if(field.value!==before)field.dispatchEvent(new Event('input',{bubbles:true}));
  field.focus({preventScroll:true});
 }
 const blocked=disabled||readOnly;
 return <div className={'spenton-number '+className}>
  <input {...props} ref={input} type="number" aria-label={props['aria-label']??label} inputMode={Number.isInteger(Number(step))?'numeric':'decimal'} value={value} defaultValue={defaultValue} disabled={disabled} readOnly={readOnly} min={min} max={max} step={step} onChange={event=>{setLocal(event.currentTarget.value);onChange?.(event);}}/>
  <button type="button" aria-label={'Decrease '+label.toLocaleLowerCase()} disabled={blocked||min!==undefined&&number<=Number(min)} onClick={()=>adjust(-1)}><Minus size={16} aria-hidden="true"/></button>
  <button type="button" aria-label={'Increase '+label.toLocaleLowerCase()} disabled={blocked||max!==undefined&&number>=Number(max)} onClick={()=>adjust(1)}><Plus size={16} aria-hidden="true"/></button>
 </div>;
}
