import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown} from 'lucide-react';
import {DropdownOptions,nextEnabled,revealDropdownOption,useDropdown} from './Dropdown';
import type {InputHTMLAttributes,ReactNode} from 'react';
import type {DropdownOption} from './Dropdown';
import './payee-picker.css';

type Props=Omit<InputHTMLAttributes<HTMLInputElement>,'value'|'defaultValue'|'onChange'|'list'|'type'> & {label:string;value?:string;defaultValue?:string;options:string[];menuLabel:string;emptyLabel?:string;leadingIcon?:ReactNode;initials?:boolean;onChange?:(value:string)=>void};
export default function SuggestionInput({label,value:controlled,defaultValue='',options:suggestions,menuLabel,emptyLabel='No suggestions yet. Type a new name.',leadingIcon,initials=false,onChange,autoFocus=false,name,placeholder,readOnly,disabled,required,maxLength=160,...props}:Props){
 const [local,setLocal]=useState(defaultValue),value=controlled??local;
 function change(next:string){setLocal(next);onChange?.(next);}

 const id=useId(),input=useRef<HTMLInputElement>(null),anchor=useRef<HTMLDivElement>(null);
 const [open,setOpen]=useState(false),[browse,setBrowse]=useState(false),[active,setActive]=useState(-1);
 const query=value.trim().toLocaleLowerCase();
 const options:DropdownOption[]=suggestions.filter(payee=>browse||payee.toLocaleLowerCase().includes(query)).map(payee=>({value:payee,label:payee,icon:initials?<span className="spenton-payee-initial">{payee[0]?.toUpperCase()}</span>:undefined}));
 const {panel,host,position}=useDropdown(anchor,open,()=>setOpen(false));
 useEffect(()=>{if(open&&active>=0)revealDropdownOption(id+'-'+active);},[active,open,id,host]);
 function choose(option:DropdownOption){change(option.value);setOpen(false);setActive(-1);input.current?.focus({preventScroll:true});}
 return <div className="spenton-suggestion">
  <div ref={anchor} className="spenton-payee-control">{leadingIcon}
   <input {...props} ref={input} role="combobox" aria-label={label} aria-expanded={open} aria-controls={id} aria-haspopup="listbox" aria-autocomplete="list" aria-activedescendant={open&&active>=0?id+'-'+active:undefined} name={name} value={value} autoFocus={autoFocus} autoComplete="off" required={required} readOnly={readOnly} disabled={disabled} maxLength={maxLength} placeholder={placeholder} onChange={event=>{const next=event.target.value;change(next);setBrowse(false);setActive(-1);setOpen(suggestions.some(payee=>payee.toLocaleLowerCase().includes(next.trim().toLocaleLowerCase())));}} onKeyDown={event=>{
    if(event.nativeEvent.isComposing||readOnly||disabled)return;
    if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();setOpen(false);return;}
    if(event.key==='Tab'){setOpen(false);return;}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();event.stopPropagation();setOpen(true);setActive(index=>nextEnabled(options,index,event.key==='ArrowDown'?1:-1));}
    if(event.key==='Enter'&&open&&active>=0&&options[active]){event.preventDefault();event.stopPropagation();choose(options[active]);}
   }}/>
   <button className="spenton-payee-browse" type="button" tabIndex={-1} aria-label={'Show '+menuLabel.toLocaleLowerCase()} disabled={disabled||readOnly} aria-expanded={open} aria-controls={id} onClick={()=>{setBrowse(true);setActive(-1);setOpen(!open);input.current?.focus({preventScroll:true});}}><ChevronDown size={16}/></button>
  </div>
  {host&&createPortal(<div ref={panel} popover="auto" className="spenton-dropdown" style={position} onToggle={event=>{event.stopPropagation();if((event.nativeEvent as ToggleEvent).newState==='closed')setOpen(false);}}><div className="spenton-dropdown-heading">{menuLabel}<span>{options.length}</span></div><DropdownOptions id={id} label={menuLabel} options={options} value={value} active={active} onActive={setActive} onChoose={choose} empty={emptyLabel}/></div>,host)}
 </div>;
}
