import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';

type Control=HTMLInputElement|HTMLTextAreaElement;
type Issue={field:Control;host:HTMLElement;id:string;message:string};

function messageFor(field:Control){
 const v=field.validity;
 if(v.customError)return field.validationMessage;
 if(v.valueMissing)return field instanceof HTMLInputElement&&field.type==='checkbox'?'Confirm this choice to continue.':field instanceof HTMLInputElement&&field.type==='radio'?'Choose an option to continue.':'Complete this field to continue.';
 if(v.typeMismatch)return field instanceof HTMLInputElement&&field.type==='email'?'Enter a valid email address.':'Enter a valid address.';
 if(v.badInput)return 'Enter a number.';
 if(v.rangeUnderflow)return 'Enter '+(field as HTMLInputElement).min+' or more.';
 if(v.rangeOverflow)return 'Enter '+(field as HTMLInputElement).max+' or less.';
 if(v.stepMismatch)return 'Use increments of '+((field as HTMLInputElement).step||'1')+'.';
 if(v.tooShort)return 'Use at least '+field.minLength+' characters.';
 if(v.tooLong)return 'Use no more than '+field.maxLength+' characters.';
 if(v.patternMismatch&&field instanceof HTMLInputElement){
  if(['DELETE','RESET'].includes(field.pattern))return 'Type '+field.pattern+' to confirm.';
  if(field.pattern==='[0-9]{6}')return 'Enter a six-digit code.';
  if(field.pattern==='([01][0-9]|2[0-3]):[0-5][0-9]')return 'Enter a time using HH:MM, such as 14:30.';
 }
 if(v.patternMismatch)return 'Use the format shown for this field.';
 return 'Check this field before continuing.';
}

function FieldIssue({issue,announce}:{issue:Issue;announce:boolean}){
 useLayoutEffect(()=>{
  const {field,id}=issue,previous=field.getAttribute('aria-invalid');
  field.setAttribute('aria-invalid','true');field.setAttribute('data-spenton-invalid','true');
  field.setAttribute('aria-describedby',[field.getAttribute('aria-describedby'),id].filter(Boolean).join(' '));
  return()=>{
   field.removeAttribute('data-spenton-invalid');
   if(field.getAttribute('aria-invalid')==='true'){if(previous===null)field.removeAttribute('aria-invalid');else field.setAttribute('aria-invalid',previous);}
   const remaining=(field.getAttribute('aria-describedby')??'').split(' ').filter(value=>value&&value!==id).join(' ');
   if(remaining)field.setAttribute('aria-describedby',remaining);else field.removeAttribute('aria-describedby');
  };
 },[issue.field,issue.id]);
 return createPortal(<small id={issue.id} className="spenton-input-error" role={announce?'alert':undefined}>{issue.message}</small>,issue.host);
}

// Keep native constraints, but present website-owned, associated field messages.
// Select and DatePicker already own their validation and visible focus target.
export default function InputFeedback(){
 const [issues,setIssues]=useState<Issue[]>([]),prefix=useId(),serial=useRef(0);
 useEffect(()=>{
  let first:Element|null=null,active=true,focusTimer:ReturnType<typeof setTimeout>|undefined;
  const invalid=(event:Event)=>{
   const field=event.target;
   if(!(field instanceof HTMLInputElement||field instanceof HTMLTextAreaElement||field instanceof HTMLSelectElement))return;
   const custom=field instanceof HTMLSelectElement||!!field.closest('.date-picker');
   if(!custom)event.preventDefault();
   if(!first){
    first=field;
    focusTimer=setTimeout(()=>{
     const invalidField=first;first=null;if(!active||!invalidField?.isConnected)return;
     const target=invalidField instanceof HTMLSelectElement?document.querySelector<HTMLElement>('[data-control-id="'+CSS.escape(invalidField.id)+'"]'):invalidField;
     if(!target)return;
     for(let ancestor=target.parentElement;ancestor;ancestor=ancestor.parentElement)if(ancestor instanceof HTMLDetailsElement)ancestor.open=true;
     (target as HTMLElement).focus({preventScroll:true});target.scrollIntoView({block:'nearest',behavior:'instant'});
    },0);
   }
   if(custom||field instanceof HTMLSelectElement||field.type==='hidden')return;
   const host=field.closest<HTMLElement>('.field')??field.closest('label')??field.parentElement;
   if(!host)return;
   const id=prefix+'-field-'+serial.current++,message=messageFor(field);
   setIssues(current=>{
    const old=current.find(issue=>issue.field===field),next={field,host,id:old?.id??id,message};
    return old?current.map(issue=>issue.field===field?next:issue):[...current,next];
   });
  };
  const edit=(event:Event)=>{
   const field=event.target;if(!(field instanceof HTMLInputElement||field instanceof HTMLTextAreaElement)||!field.validity.valid)return;
   setIssues(current=>current.some(issue=>issue.field===field)?current.filter(issue=>issue.field!==field):current);
  };
  const reset=(event:Event)=>setIssues(current=>current.filter(issue=>issue.field.form!==event.target));
  document.addEventListener('invalid',invalid,true);document.addEventListener('input',edit);document.addEventListener('change',edit);document.addEventListener('focusout',edit);document.addEventListener('reset',reset);
  return()=>{active=false;clearTimeout(focusTimer);document.removeEventListener('invalid',invalid,true);document.removeEventListener('input',edit);document.removeEventListener('change',edit);document.removeEventListener('focusout',edit);document.removeEventListener('reset',reset);};
 },[prefix]);
 useEffect(()=>{
  if(!issues.length)return;
  const observer=new MutationObserver(()=>setIssues(current=>current.some(issue=>!issue.field.isConnected||!issue.host.isConnected)?current.filter(issue=>issue.field.isConnected&&issue.host.isConnected):current));
  observer.observe(document.getElementById('root')!,{subtree:true,childList:true});
  return()=>observer.disconnect();
 },[issues.length]);
 return issues.map((issue,index)=><FieldIssue key={issue.id} issue={issue} announce={index===0}/>);
}
