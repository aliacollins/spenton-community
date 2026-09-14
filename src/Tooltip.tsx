import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {useDropdown} from './Dropdown';

function Tooltip({anchor,onClose}:{anchor:HTMLElement;onClose:()=>void}){
 const trigger=useRef<HTMLElement>(anchor),id=useId();
 const {panel,host,position}=useDropdown(trigger,true,onClose,{minWidth:180,maxWidth:320,maxHeight:180});
 const [text,setText]=useState(anchor.dataset.tooltip??'');
 useLayoutEffect(()=>{
  anchor.setAttribute('aria-describedby',[anchor.getAttribute('aria-describedby'),id].filter(Boolean).join(' '));
  const observer=new MutationObserver(()=>{if(!anchor.isConnected)onClose();else setText(anchor.dataset.tooltip??'');});
  observer.observe(document.getElementById('root')!,{childList:true,subtree:true});
  observer.observe(anchor,{attributes:true,attributeFilter:['data-tooltip']});
  return()=>{
   observer.disconnect();
   const next=(anchor.getAttribute('aria-describedby')??'').split(' ').filter(part=>part&&part!==id).join(' ');
   if(next)anchor.setAttribute('aria-describedby',next);else anchor.removeAttribute('aria-describedby');
  };
 },[anchor,id,onClose]);
 return host&&createPortal(<div ref={panel} id={id} popover="manual" role="tooltip" className="spenton-tooltip" style={position}>{text}</div>,host);
}

export default function Tooltips(){
 const [targetState,setTarget]=useState<{anchor:HTMLElement;version:number}|null>(null),current=useRef<HTMLElement|null>(null),serial=useRef(0);
 const close=useRef(()=>{current.current=null;setTarget(null);}).current;
 useEffect(()=>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  const clear=()=>{if(timer)clearTimeout(timer);timer=undefined;};
  const target=(event:Event)=>event.target instanceof Element?event.target.closest<HTMLElement>('[data-tooltip]'):null;
  const show=(element:HTMLElement|null,delay:number)=>{
   clear();if(!element?.dataset.tooltip){close();return;}
   if(current.current===element)return;
   close();timer=setTimeout(()=>{if(element.isConnected){current.current=element;setTarget({anchor:element,version:serial.current++});}},delay);
  };
  const over=(event:PointerEvent)=>{if(event.pointerType==='touch')return;if(event.target instanceof Element&&event.target.closest('.spenton-tooltip')){clear();return;}show(target(event),300);};
  const out=(event:PointerEvent)=>{
   if(event.relatedTarget instanceof Node&&(current.current?.contains(event.relatedTarget)||(event.relatedTarget instanceof Element&&event.relatedTarget.closest('.spenton-tooltip'))))return;
   clear();timer=setTimeout(close,100);
  };
  const focus=(event:FocusEvent)=>show(target(event),0);
  const blur=()=>{clear();close();};
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape')blur();};
  document.addEventListener('pointerover',over);document.addEventListener('pointerout',out);document.addEventListener('focusin',focus);document.addEventListener('focusout',blur);document.addEventListener('keydown',key,true);
  window.addEventListener('scroll',blur,true);window.addEventListener('resize',blur);
  return()=>{clear();document.removeEventListener('pointerover',over);document.removeEventListener('pointerout',out);document.removeEventListener('focusin',focus);document.removeEventListener('focusout',blur);document.removeEventListener('keydown',key,true);window.removeEventListener('scroll',blur,true);window.removeEventListener('resize',blur);};
 },[close]);
 return targetState?<Tooltip key={targetState.version} anchor={targetState.anchor} onClose={close}/>:null;
}
