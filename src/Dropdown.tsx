import {useLayoutEffect,useRef,useState} from 'react';
import type {ReactNode,RefObject} from 'react';
import {Check} from 'lucide-react';
import './selects.css';

export type DropdownOption={value:string;label:string;group?:string;disabled?:boolean;icon?:ReactNode};

// The top layer keeps menus above dialogs and scroll containers. Nesting the
// portal in its enclosing popover also keeps calendar dropdowns together.
export function useDropdown(anchor:RefObject<HTMLElement|null>,open:boolean,dismiss:()=>void,{minWidth=248,maxWidth=420,maxHeight:heightLimit=380,overlapAnchor=false}:{minWidth?:number;maxWidth?:number;maxHeight?:number;overlapAnchor?:boolean}={}){
 const panel=useRef<HTMLDivElement>(null),dismissRef=useRef(dismiss);
 const [host,setHost]=useState<HTMLElement|null>(null);
 const [position,setPosition]=useState({left:12,top:12,width:280,maxHeight:360});
 dismissRef.current=dismiss;
 useLayoutEffect(()=>{if(open)setHost(anchor.current?.closest<HTMLElement>('[popover],dialog')??document.body);},[open,anchor]);
 useLayoutEffect(()=>{
  const popup=panel.current;if(!popup||!host)return;
  if(!open){if(popup.matches(':popover-open'))popup.hidePopover();return;}
  if(!popup.matches(':popover-open'))popup.showPopover();
  const place=()=>{
   const rect=anchor.current?.getBoundingClientRect();if(!rect)return;
   const viewport=window.visualViewport,left=(viewport?.offsetLeft??0)+12,top=(viewport?.offsetTop??0)+12;
   const width=viewport?.width??innerWidth,height=viewport?.height??innerHeight;
   const below=top+height-24-rect.bottom-8,above=rect.top-top-8;
   const menuWidth=Math.min(Math.max(rect.width,minWidth),maxWidth,width-24);
   const maxHeight=Math.max(80,Math.min(heightLimit,height-24,overlapAnchor?height-24:Math.max(below,above)));
   const actualHeight=Math.min(popup.offsetHeight||maxHeight,maxHeight);
   const preferredTop=below>=actualHeight||below>=above?rect.bottom+8:rect.top-actualHeight-8;
   const next={left:Math.max(left,Math.min(rect.left,left+width-24-menuWidth)),top:Math.max(top,Math.min(preferredTop,top+height-24-actualHeight)),width:menuWidth,maxHeight};
   setPosition(previous=>Object.keys(next).every(key=>next[key as keyof typeof next]===previous[key as keyof typeof previous])?previous:next);
  };
  const scroll=(event:Event)=>{if(event.target instanceof Node&&popup.contains(event.target))return;const rect=anchor.current?.getBoundingClientRect();if(!rect||rect.bottom<0||rect.top>innerHeight){dismissRef.current();return;}place();};
  place();const observer=new ResizeObserver(place);observer.observe(popup);
  window.addEventListener('resize',place);window.addEventListener('scroll',scroll,true);
  window.visualViewport?.addEventListener('resize',place);
  return()=>{observer.disconnect();window.removeEventListener('resize',place);window.removeEventListener('scroll',scroll,true);window.visualViewport?.removeEventListener('resize',place);};
 },[open,host,anchor,minWidth,maxWidth,heightLimit,overlapAnchor]);
 return {panel,host,position};
}

export function DropdownOptions({id,label,options,value,active,onActive,onChoose,empty='No matching options'}:{id:string;label:string;options:DropdownOption[];value:string;active:number;onActive:(index:number)=>void;onChoose:(option:DropdownOption)=>void;empty?:string}){
 return <div id={id} role="listbox" aria-label={label} className="spenton-options">{options.map((option,index)=><div key={option.value}>
  {option.group&&option.group!==options[index-1]?.group&&<div className="spenton-option-group">{option.group}</div>}
  <div id={id+'-'+index} role="option" aria-label={option.label} aria-selected={option.value===value} aria-disabled={option.disabled||undefined} data-value={option.value} className={'spenton-option '+(active===index?'is-active ':'')+(option.value===value?'is-selected':'')} onPointerMove={()=>{if(!option.disabled)onActive(index);}} onMouseDown={event=>event.preventDefault()} onClick={()=>{if(!option.disabled)onChoose(option);}}>
   {option.icon&&<span className="spenton-option-icon" aria-hidden="true">{option.icon}</span>}<span className="spenton-option-label">{option.label}</span>{option.value===value&&<Check size={16} className="spenton-option-check" aria-hidden="true"/>}
  </div>
 </div>)}{!options.length&&<p role="status" className="spenton-options-empty">{empty}</p>}</div>;
}

export function nextEnabled(options:DropdownOption[],active:number,direction:number){
 for(let index=active+direction;index>=0&&index<options.length;index+=direction)if(!options[index].disabled)return index;
 return active;
}

export function revealDropdownOption(id:string){
 const option=document.getElementById(id),list=option?.closest('.spenton-options');if(!option||!list)return;
 const row=option.getBoundingClientRect(),viewport=list.getBoundingClientRect();
 if(row.bottom>viewport.bottom)list.scrollTop+=row.bottom-viewport.bottom;
 else if(row.top<viewport.top)list.scrollTop-=viewport.top-row.top;
}
