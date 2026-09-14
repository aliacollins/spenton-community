import { Heart } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import pipArtwork from './brand/pip.svg?raw';
import './pip.css';

type Mood='idle'|'wave'|'curious'|'swing'|'stretch'|'yawn'|'sleepy'|'snuggle'|'worried'|'relieved';
export default function PipCompanion({concern=0,motionEnabled=true,reactToConcern=true,savedRevision}:{concern?:number;motionEnabled?:boolean;reactToConcern?:boolean;savedRevision?:number}){
 const root=useRef<HTMLDivElement>(null),petTimer=useRef<ReturnType<typeof setTimeout>|null>(null),previousConcern=useRef(concern);
 const previousSave=useRef(savedRevision);
 const [mood,setMood]=useState<Mood>('idle'),[paused,setPaused]=useState(false),[reduced,setReduced]=useState(false),[petted,setPetted]=useState(false);
 const [reaction,setReaction]=useState<'worried'|'relieved'|null>(null),[menu,setMenu]=useState(false),[saveReaction,setSaveReaction]=useState(false);
 const resting=paused||reduced||!motionEnabled,displayMood=petted?'snuggle':reaction??mood;
 useEffect(()=>{const query=matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReduced(query.matches);update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[]);
 useEffect(()=>{
  if(!reactToConcern||concern===previousConcern.current)return;
  const next=concern>previousConcern.current?'worried':'relieved';previousConcern.current=concern;setReaction(next);
  const timer=setTimeout(()=>setReaction(null),next==='worried'?10000:5500);return()=>clearTimeout(timer);
 },[concern,reactToConcern]);
 useEffect(()=>{
  const previous=previousSave.current;previousSave.current=savedRevision;
  if(savedRevision===undefined||previous===undefined){setSaveReaction(false);setReaction(null);return;}
  if(savedRevision===previous)return;
  setSaveReaction(true);setReaction(concern>0?'worried':'relieved');
  const timer=setTimeout(()=>{setSaveReaction(false);setReaction(null);},3500);
  return()=>clearTimeout(timer);
 },[savedRevision]);
 useEffect(()=>{
  if(resting)return;
  const sequence:{mood:Mood;duration:number}[]=[{mood:'swing',duration:8000},{mood:'curious',duration:5000},{mood:'wave',duration:4000},{mood:'idle',duration:7000},{mood:'stretch',duration:4000},{mood:'yawn',duration:3000},{mood:'sleepy',duration:10000},{mood:'idle',duration:5000}];
  let index=0,frame=0,timer:ReturnType<typeof setTimeout>;
  const next=()=>{const state=sequence[index++%sequence.length];if(document.visibilityState==='visible'&&!petTimer.current)setMood(state.mood);timer=setTimeout(next,state.duration);};
  timer=setTimeout(next,4500);
  const look=(event:PointerEvent)=>{if(frame)return;const {clientX,clientY}=event;frame=requestAnimationFrame(()=>{frame=0;if(!root.current)return;const rect=root.current.getBoundingClientRect();root.current.style.setProperty('--pip-look-x',Math.max(-3,Math.min(3,(clientX-rect.x-rect.width/2)/100))+'px');root.current.style.setProperty('--pip-look-y',Math.max(-2,Math.min(2,(clientY-rect.y-rect.height/2)/130))+'px');});};
  window.addEventListener('pointermove',look,{passive:true});
  return()=>{clearTimeout(timer);cancelAnimationFrame(frame);window.removeEventListener('pointermove',look);};
 },[resting]);
 useEffect(()=>()=>{if(petTimer.current)clearTimeout(petTimer.current);},[]);
 function pet(){if(petTimer.current)clearTimeout(petTimer.current);setPetted(true);petTimer.current=setTimeout(()=>{setMood('idle');setPetted(false);petTimer.current=null;},4200);}
 return <div ref={root} className={'pip-companion '+(resting?'pip-resting':'')} data-mood={displayMood}>
  <span className="pip-bubble" role="status" aria-live={petted||reaction?'polite':'off'}>{petted?'A little happy wiggle.':saveReaction?'Your change is saved.':reaction==='worried'?'A shortfall needs a little care.':reaction==='relieved'?'A little more breathing room.':''}</span>
  <button className="pip-pet" type="button" aria-label="Give Pip a cuddle" data-tooltip="Click to cuddle. Right-click for Pip settings." onClick={()=>{setMenu(false);pet();}} onContextMenu={e=>{e.preventDefault();setMenu(!menu);}} onKeyDown={e=>{if(e.key==='Escape')setMenu(false);if(e.key==='F10'&&e.shiftKey){e.preventDefault();setMenu(!menu);}}}><span className="pip-art" aria-hidden="true" dangerouslySetInnerHTML={{__html:pipArtwork}}/><span className="pip-heart pip-heart-one" aria-hidden="true"><Heart size="1em" fill="currentColor" strokeWidth={0}/></span><span className="pip-heart pip-heart-two" aria-hidden="true"><Heart size="1em" fill="currentColor" strokeWidth={0}/></span><span className="pip-snooze" aria-hidden="true">z z Z</span></button>
  {menu&&<div className="pip-controls" onKeyDown={e=>{if(e.key==='Escape')setMenu(false);}}><button type="button" onClick={()=>{if(petTimer.current){clearTimeout(petTimer.current);petTimer.current=null;}setPetted(false);setPaused(!paused);setMood('idle');setMenu(false);}}>{paused?'Wake Pip up':"Pause Pip's movement"}</button></div>}
 </div>;
}
