import {Children,isValidElement,useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import type {KeyboardEvent,ReactNode,SelectHTMLAttributes} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown,Search} from 'lucide-react';
import {DropdownOptions,nextEnabled,revealDropdownOption,useDropdown} from './Dropdown';
import type {DropdownOption} from './Dropdown';

type Props=Omit<SelectHTMLAttributes<HTMLSelectElement>,'multiple'|'size'> & {searchable?:boolean;renderIcon?:(value:string)=>ReactNode};
function text(node:ReactNode):string{return Children.toArray(node).map(child=>isValidElement<{children?:ReactNode}>(child)?text(child.props.children):String(child)).join('');}
function optionsFrom(children:ReactNode,group?:string,disabled=false):DropdownOption[]{
 return Children.toArray(children).flatMap(child=>{
  if(!isValidElement<{children?:ReactNode;value?:string|number;label?:string;disabled?:boolean}>(child))return [];
  const props=child.props;
  if(child.type==='option'){const label=props.label??text(props.children);return [{value:String(props.value??label),label,group,disabled:disabled||props.disabled}];}
  return optionsFrom(props.children,child.type==='optgroup'?props.label:group,disabled||!!props.disabled);
 });
}

export default function Select({children,value,defaultValue,onChange,disabled,required,className='',style,searchable,renderIcon,id,...props}:Props){
 const uid=useId(),triggerId=id??uid+'-trigger',nativeId=uid+'-value',listId=uid+'-list';
 const trigger=useRef<HTMLButtonElement>(null),root=useRef<HTMLDivElement>(null),native=useRef<HTMLSelectElement>(null),search=useRef<HTMLInputElement>(null);
 const [formHost,setFormHost]=useState<HTMLElement|null>(null),[local,setLocal]=useState(String(value??defaultValue??''));
 const [label,setLabel]=useState(props['aria-label']??props.name??'Choose an option');
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(-1),[invalid,setInvalid]=useState(false);
 const typeahead=useRef({text:'',time:0});
 const options=optionsFrom(children).map(option=>({...option,icon:renderIcon?.(option.value)}));
 const selectedValue=value===undefined?local:String(value),selected=options.find(option=>option.value===selectedValue);
 const matches=options.filter(option=>(option.label+' '+(option.group??'')).toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 const canSearch=searchable??options.length>8;
 const {panel,host,position}=useDropdown(trigger,open,()=>setOpen(false));
 useLayoutEffect(()=>{
  setFormHost(root.current?.closest('form')??document.body);
  if(props['aria-label']){setLabel(props['aria-label']);return;}
  const parent=root.current?.closest('label')??(id?document.querySelector<HTMLLabelElement>('label[for="'+CSS.escape(id)+'"]'):null);
  if(parent){const walker=document.createTreeWalker(parent,NodeFilter.SHOW_TEXT);let node:Node|null,content='';while((node=walker.nextNode())){if(root.current?.contains(node))break;content+=node.textContent;}if(content.trim())setLabel(content.trim());}
 });
 useLayoutEffect(()=>{if(native.current)setLocal(native.current.value);});
 useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
 useEffect(()=>{if(open&&host){const frame=requestAnimationFrame(()=>{if(canSearch)search.current?.focus({preventScroll:true});});return()=>cancelAnimationFrame(frame);}},[open,host,canSearch]);
 useEffect(()=>{if(open&&active>=0)revealDropdownOption(listId+'-'+active);},[active,open,query,listId,host]);
 useEffect(()=>{const form=native.current?.form;if(!form)return;const reset=()=>queueMicrotask(()=>{setLocal(native.current?.value??'');setInvalid(false);setOpen(false);});form.addEventListener('reset',reset);return()=>form.removeEventListener('reset',reset);},[formHost]);
 function close(restore=true){setOpen(false);if(restore)trigger.current?.focus({preventScroll:true});}
 function show(){if(disabled)return;trigger.current?.focus({preventScroll:true});setQuery('');setActive(Math.max(0,options.findIndex(option=>option.value===selectedValue&&!option.disabled)));setOpen(true);}
 function choose(option:DropdownOption){
  if(option.disabled||!native.current)return;close();setInvalid(false);
  native.current.value=option.value;native.current.dispatchEvent(new Event('change',{bubbles:true}));
 }
 function keydown(event:KeyboardEvent<HTMLElement>,editing=false){
  if(event.nativeEvent.isComposing)return;
  if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();close();return;}
  if(event.key==='Tab'&&open){close();return;}
  if(event.key==='Enter'||(!editing&&event.key===' ')){
   event.preventDefault();event.stopPropagation();if(open){if(matches[active])choose(matches[active]);}else show();return;
  }
  if(['ArrowDown','ArrowUp'].includes(event.key)||(!editing&&['Home','End'].includes(event.key))){
   event.preventDefault();event.stopPropagation();
   if(!open){show();return;}
   if(event.key==='Home')setActive(nextEnabled(matches,-1,1));
   else if(event.key==='End')setActive(nextEnabled(matches,matches.length,-1));
   else setActive(index=>nextEnabled(matches,index,event.key==='ArrowDown'?1:-1));return;
  }
  if(!editing&&event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
   event.preventDefault();event.stopPropagation();const now=Date.now();typeahead.current={text:now-typeahead.current.time<700?typeahead.current.text+event.key:event.key,time:now};
   if(!open)show();const match=options.findIndex(option=>!option.disabled&&option.label.toLocaleLowerCase().startsWith(typeahead.current.text.toLocaleLowerCase()));if(match>=0)setActive(match);
  }
 }
 return <div ref={root} className={'spenton-select '+className}>
  {formHost&&createPortal(<select {...props} id={nativeId} ref={native} style={{display:'none'}} aria-label={undefined} aria-labelledby={undefined} aria-describedby={undefined} aria-hidden="true" tabIndex={-1} value={value} defaultValue={defaultValue} disabled={disabled} required={required} onChange={event=>{setLocal(event.currentTarget.value);setInvalid(false);onChange?.(event);}} onInvalid={event=>{event.preventDefault();setInvalid(true);close(!event.currentTarget.form||event.currentTarget.form.querySelector(':invalid')===event.currentTarget);props.onInvalid?.(event);}}>{children}</select>,formHost)}
  <button ref={trigger} id={triggerId} type="button" role="combobox" className="spenton-select-trigger" style={style} data-control-id={nativeId} data-value={selectedValue} aria-label={label} aria-labelledby={props['aria-labelledby']} aria-describedby={[props['aria-describedby'],invalid?uid+'-error':''].filter(Boolean).join(' ')||undefined} aria-haspopup="listbox" aria-controls={listId} aria-expanded={open} aria-required={required||undefined} aria-invalid={invalid||props['aria-invalid']} aria-activedescendant={open&&!canSearch&&active>=0?listId+'-'+active:undefined} disabled={disabled} onClick={()=>open?close():show()} onKeyDown={event=>keydown(event)}>
   {selected?.icon&&<span className="spenton-option-icon">{selected.icon}</span>}<span className="spenton-select-label">{selected?.label??'Choose an option'}</span><ChevronDown size={16} className="spenton-select-chevron" aria-hidden="true"/>
  </button>
  {invalid&&<small id={uid+'-error'} className="spenton-select-error" role="alert">Choose an option to continue.</small>}
  {host&&createPortal(<div ref={panel} popover="auto" className="spenton-dropdown" style={position} onToggle={event=>{event.stopPropagation();if((event.nativeEvent as ToggleEvent).newState==='closed')setOpen(false);}}>
   {canSearch&&<div className="spenton-dropdown-search"><Search size={16} aria-hidden="true"/><input ref={search} role="combobox" aria-label={'Search '+label.toLocaleLowerCase()} aria-controls={listId} aria-expanded={open} aria-autocomplete="list" aria-activedescendant={active>=0?listId+'-'+active:undefined} placeholder="Search options" value={query} autoComplete="off" onChange={event=>{const q=event.target.value;setQuery(q);setActive(options.filter(option=>(option.label+' '+(option.group??'')).toLocaleLowerCase().includes(q.toLocaleLowerCase())).findIndex(option=>!option.disabled));}} onKeyDown={event=>keydown(event,true)}/></div>}
   <DropdownOptions id={listId} label={label+' options'} options={matches} value={selectedValue} active={active} onActive={setActive} onChoose={choose}/>
  </div>,host)}
 </div>;
}
