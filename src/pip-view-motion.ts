import {useLayoutEffect,useRef} from 'react';
import type {RefObject} from 'react';

const groups='.pip-mobile-tabs,.sidebar nav[aria-label="Main navigation"],.filter-tabs,.people-sections,.people-filters,.transaction-tabs,.goal-kind,.goal-timeline-choice,.group-split-methods';
const selectedSelector='button.active,button[aria-current="page"],button[aria-pressed="true"],button[aria-selected="true"]';
type GroupState={index:number;button:HTMLElement};

/** Presentation only: these observers never dispatch actions, submit forms or change React state. */
export function usePipViewMotion(root:RefObject<HTMLDivElement|null>,enabled:boolean,motion:boolean,pageKey:string){
 const previousPage=useRef(pageKey),pageAnimation=useRef<Animation|null>(null);
 useLayoutEffect(()=>{
  const app=root.current;
  if(!app||!enabled)return;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const tracked=new Map<HTMLElement,GroupState>(),animations=new Set<Animation>(),opened=new WeakSet<HTMLDialogElement>();
  let frame=0,disposed=false;
  const animate=(element:HTMLElement|null,direction=1)=>{
   if(!element||!motion||document.hidden)return;
   const frames=reduced.matches?[{opacity:.84},{opacity:1}]:[{opacity:.84,transform:`translateY(${direction*8}px)`},{opacity:1,transform:'translateY(0)'}];
   const animation=element.animate(frames,{duration:reduced.matches?100:190,easing:'cubic-bezier(.2,.75,.2,1)'});
   animations.add(animation);animation.finished.then(()=>animations.delete(animation),()=>animations.delete(animation));
  };
  const panelFor=(group:HTMLElement):HTMLElement|null=>{
   if(group.matches('.people-sections'))return app.querySelector('.expense-groups,.shared-content');
   if(group.matches('.filter-tabs'))return app.querySelector('.ledger-scroll');
   if(group.matches('.transaction-tabs'))return group.closest('dialog')?.querySelector('form .form-body')??null;
   if(group.matches('.goal-kind'))return group.closest('.goal-fields')?.querySelector('.goal-amounts')??null;
   if(group.matches('.goal-timeline-choice'))return group.closest('.goal-timing')?.querySelector(':scope>.field')??null;
   if(group.matches('.group-split-methods'))return group.parentElement?.querySelector('.group-plan-rows')??null;
   return null;
  };
  function update(){
   frame=0;if(disposed)return;
   for(const [group] of tracked)if(!group.isConnected){resize.unobserve(group);tracked.delete(group);}
   app!.querySelectorAll<HTMLElement>(groups).forEach(group=>{
    const button=group.querySelector<HTMLElement>(selectedSelector);
    if(!button||!group.getClientRects().length||getComputedStyle(group).visibility==='hidden')return;
    const index=[...group.querySelectorAll('button')].indexOf(button as HTMLButtonElement),previous=tracked.get(group);
    if(!previous)resize.observe(group);
    group.dataset.pipMotionGroup=group.matches('.goal-kind')?'cards':'pill';
    const outer=group.getBoundingClientRect(),rect=button.getBoundingClientRect(),style=getComputedStyle(group);
    group.style.setProperty('--pip-selection-x',`${rect.left-outer.left-parseFloat(style.borderLeftWidth||'0')}px`);
    group.style.setProperty('--pip-selection-y',`${rect.top-outer.top-parseFloat(style.borderTopWidth||'0')}px`);
    group.style.setProperty('--pip-selection-width',`${rect.width}px`);
    group.style.setProperty('--pip-selection-height',`${rect.height}px`);
    if(previous&&previous.index!==index&&!group.matches('.sidebar nav'))animate(panelFor(group),Math.sign(index-previous.index));
    tracked.set(group,{index,button});
   });
   app!.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog=>{
    if(opened.has(dialog))return;opened.add(dialog);
    if(motion&&!reduced.matches){
     // Keep the financial surface opaque while the sheet settles into place.
     const animation=dialog.animate([{transform:'translateY(9px) scale(.99)'},{transform:'translateY(0) scale(1)'}],{duration:180,easing:'cubic-bezier(.2,.75,.2,1)'});
     animations.add(animation);animation.finished.then(()=>animations.delete(animation),()=>animations.delete(animation));
    }
   });
  }
  const schedule=()=>{if(!frame&&!disposed)frame=requestAnimationFrame(update);};
  const resize=new ResizeObserver(schedule);
  const mutations=new MutationObserver(schedule);
  mutations.observe(app,{subtree:true,childList:true,attributes:true,attributeFilter:['class','aria-current','aria-pressed','aria-selected','open']});
  resize.observe(app);
  const reduceChanged=()=>{for(const animation of animations)animation.cancel();schedule();};
  const navigateWithKeyboard=(event:KeyboardEvent)=>{
   if(event.altKey||event.ctrlKey||event.metaKey||!(event.target instanceof HTMLElement))return;
   const button=event.target.closest<HTMLButtonElement>('button'),group=button?.parentElement;
   if(!button||!group?.matches(groups)||button.matches(':disabled'))return;
   const vertical=group.matches('.sidebar nav'),previousKey=vertical?'ArrowUp':'ArrowLeft',nextKey=vertical?'ArrowDown':'ArrowRight';
   if(![previousKey,nextKey,'Home','End'].includes(event.key))return;
   const buttons=[...group.querySelectorAll<HTMLButtonElement>(':scope>button')].filter(item=>!item.matches(':disabled'));
   const index=buttons.indexOf(button);if(index<0||!buttons.length)return;
   event.preventDefault();event.stopPropagation();
   const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key===nextKey?1:-1)+buttons.length)%buttons.length;
   buttons[next].focus({preventScroll:true});buttons[next].click();
  };
  reduced.addEventListener('change',reduceChanged);
  window.addEventListener('resize',schedule);
  app.addEventListener('keydown',navigateWithKeyboard);
  document.fonts.ready.then(schedule);
  update();
  return()=>{
   disposed=true;cancelAnimationFrame(frame);mutations.disconnect();resize.disconnect();
   window.removeEventListener('resize',schedule);reduced.removeEventListener('change',reduceChanged);
   app.removeEventListener('keydown',navigateWithKeyboard);
   for(const animation of animations)animation.cancel();
   for(const group of tracked.keys()){
    delete group.dataset.pipMotionGroup;
    for(const property of ['x','y','width','height'])group.style.removeProperty('--pip-selection-'+property);
   }
  };
 },[root,enabled,motion]);
 useLayoutEffect(()=>{
  const previous=previousPage.current;previousPage.current=pageKey;pageAnimation.current?.cancel();
  if(!enabled||!motion||previous===pageKey||document.hidden)return;
  const panel=root.current?.querySelector<HTMLElement>('.main-content');if(!panel)return;
  const order=['budget','people','transactions','accounts','insights'],direction=Math.sign(order.indexOf(pageKey)-order.indexOf(previous))||1;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const horizontal=matchMedia('(max-width:760px)').matches;
  const frames=reduced?[{opacity:.84},{opacity:1}]:[{opacity:.84,transform:horizontal?`translateX(${direction*12}px)`:`translateY(${direction*12}px)`},{opacity:1,transform:'translate(0,0)'}];
  pageAnimation.current=panel.animate(frames,{duration:reduced?100:240,easing:'cubic-bezier(.2,.8,.2,1)'});
  pageAnimation.current.finished.catch(()=>{});
  return()=>pageAnimation.current?.cancel();
 },[root,enabled,motion,pageKey]);
}
