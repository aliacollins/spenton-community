import {useEffect,useLayoutEffect,useState} from 'react';

export type AppAppearance={view:'current'|'pip';motion:boolean};
export const DEFAULT_APPEARANCE:Readonly<AppAppearance>={view:'current',motion:true};
const prefix='spenton.appearance.v1:';
export const appearanceKey=(userId:string)=>prefix+userId;

export function parseAppearance(raw:string|null):AppAppearance{
 try{
  const value:unknown=JSON.parse(raw??'null');
  if(value&&typeof value==='object'&&'view' in value&&'motion' in value
   &&(value.view==='current'||value.view==='pip')&&typeof value.motion==='boolean'){
   return {view:value.view,motion:value.motion};
  }
 }catch{/* An absent or invalid UI preference keeps the existing view. */}
 return {...DEFAULT_APPEARANCE};
}

export function readAppearance(userId:string):AppAppearance{
 try{return parseAppearance(localStorage.getItem(appearanceKey(userId)));}
 catch{return {...DEFAULT_APPEARANCE};}
}

export function writeAppearance(userId:string,value:AppAppearance):boolean{
 try{
  // Store presentation choices only. Budgets, drafts and credentials never enter this preference.
  localStorage.setItem(appearanceKey(userId),JSON.stringify({view:value.view,motion:value.motion}));
  return true;
 }catch{return false;}
}

export function useAppAppearance(userId:string){
 const [appearance,setAppearance]=useState(()=>readAppearance(userId));
 const [remembered,setRemembered]=useState(true);
 useEffect(()=>{
  setAppearance(readAppearance(userId));setRemembered(true);
  const changed=(event:StorageEvent)=>{
   if(event.key===appearanceKey(userId)||event.key===null)setAppearance(parseAppearance(event.newValue));
  };
  window.addEventListener('storage',changed);
  return()=>window.removeEventListener('storage',changed);
 },[userId]);
 useLayoutEffect(()=>{
  const html=document.documentElement;
  html.dataset.spentonView=appearance.view;
  html.dataset.spentonMotion=appearance.motion?'on':'off';
  return()=>{delete html.dataset.spentonView;delete html.dataset.spentonMotion;};
 },[appearance]);
 function update(value:AppAppearance){setAppearance(value);setRemembered(writeAppearance(userId,value));}
 return {appearance,update,remembered};
}
