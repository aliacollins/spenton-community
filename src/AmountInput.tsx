import {useRef} from 'react';
import type {InputHTMLAttributes} from 'react';

// inputMode only changes the mobile keyboard. Reject non-money characters as
// a whole edit; never strip a pasted payload into a different, valid amount.
export default function AmountInput({onChange,onBlur,...props}:InputHTMLAttributes<HTMLInputElement>){
 const previous=useRef(String(props.value??props.defaultValue??''));
 return <input {...props} inputMode="decimal" maxLength={32} onChange={event=>{
  const field=event.currentTarget;
  if(!/^[\d\s.,+\-$€£₹]*$/.test(field.value)||field.value.length>32){
   field.value=String(props.value??previous.current);
   field.setCustomValidity('Enter an amount using digits and up to two decimal places.');field.reportValidity();return;
  }
  field.setCustomValidity('');previous.current=field.value;onChange?.(event);
 }} onBlur={event=>{event.currentTarget.setCustomValidity('');onBlur?.(event);}}/>;
}
