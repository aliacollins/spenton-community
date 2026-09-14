import {PipFieldGuide} from './PipGuidance';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode, FormEvent, RefObject } from 'react';
import { X, ArrowUpRight, Home, ShoppingBasket, CarFront, Zap, Repeat2, Coffee, Heart, Sparkles, Umbrella, Plane, Laptop, Wallet, CircleHelp, PawPrint, Baby, GraduationCap, Stethoscope, Gift, Utensils, Smartphone, Bike, Music, Shirt } from 'lucide-react';
import type { Category } from './engine';
import pipIllustration from './brand/pip.svg';
export function CategoryIcon({category,size=17}:{category:Pick<Category,'icon'|'color'>;size?:number}){
 const icons:Record<string,typeof Home>={home:Home,basket:ShoppingBasket,car:CarFront,zap:Zap,repeat:Repeat2,coffee:Coffee,heart:Heart,sparkles:Sparkles,umbrella:Umbrella,plane:Plane,laptop:Laptop,wallet:Wallet,paw:PawPrint,baby:Baby,study:GraduationCap,health:Stethoscope,gift:Gift,food:Utensils,phone:Smartphone,bike:Bike,music:Music,shirt:Shirt};
 const Icon=icons[category.icon]??Wallet;return <span className={'category-icon '+category.color}><Icon size={size} strokeWidth={1.65}/></span>;
}
export function IconPicker({initial='wallet',color='sage'}:{initial?:string;color?:string}){
 const [icon,setIcon]=useState(initial);
 const choices:Record<string,string>={home:'Home',basket:'Groceries',car:'Car',zap:'Utilities',repeat:'Subscriptions',coffee:'Coffee',heart:'Heart',sparkles:'Fun',umbrella:'Rainy day',plane:'Travel',laptop:'Technology',wallet:'Wallet',paw:'Pets',baby:'Children',study:'Education',health:'Health',gift:'Gifts',food:'Dining',phone:'Phone',bike:'Bike',music:'Music',shirt:'Clothing'};
 return <fieldset className="icon-picker" data-color={color}><legend>Choose an icon</legend><input type="hidden" name="icon" value={icon}/><div>{Object.entries(choices).map(([value,label])=><button key={value} type="button" aria-label={label+' icon'} aria-pressed={value===icon} data-tooltip={label} onClick={()=>setIcon(value)}><CategoryIcon category={{icon:value,color}} size={22}/></button>)}</div></fieldset>;
}
export function Modal({title,eyebrow,children,onClose,wide=false,className='',guideMessage,role='dialog',descriptionId,initialFocus,returnFocus}:{title:string;eyebrow?:string;children:ReactNode;onClose:()=>void;wide?:boolean;className?:string;guideMessage?:string;role?:'dialog'|'alertdialog';descriptionId?:string;initialFocus?:RefObject<HTMLElement|null>;returnFocus?:HTMLElement|null}){
 const ref=useRef<HTMLDialogElement>(null);
 const titleID=useId();
 useEffect(()=>{const d=ref.current;const trigger=returnFocus??document.activeElement;d?.showModal();initialFocus?.current?.focus({preventScroll:true});return()=>{d?.close();if(trigger instanceof HTMLElement&&trigger.isConnected)trigger.focus({preventScroll:true});};},[]);
 return <dialog ref={ref} role={role} aria-describedby={descriptionId} className={'modal '+(wide?'modal-wide ':'')+(className||'modal-standard')} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===ref.current){const rect=ref.current.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)onClose();}}} aria-labelledby={titleID}><div className="modal-header"><div>{eyebrow&&<span className="eyebrow">{eyebrow}</span>}<h2 id={titleID}>{title}</h2></div>{!className&&eyebrow&&<img className="modal-pip" src={pipIllustration} alt=""/>}<button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></div><PipFieldGuide dialogRef={ref} title={title} message={guideMessage}/>{children}</dialog>;
}
export function Form({children,onSubmit,label='Save changes',onClose,submitIcon=true,submitTone='primary'}:{children:ReactNode;onSubmit:(data:FormData)=>void;label?:string;onClose:()=>void;submitIcon?:boolean;submitTone?:'primary'|'danger'}){
 const [error,setError]=useState('');const errorRef=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{if(error)errorRef.current?.scrollIntoView({block:'nearest'});},[error]);
 function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setError('');try{onSubmit(new FormData(e.currentTarget));}catch(err){setError(err instanceof Error?err.message:'Something went wrong. Please try again.');}}
 return <form onSubmit={submit} onChange={()=>{if(error)setError('');}}><div className="form-body">{children}{error&&<p ref={errorRef} role="alert" className="form-error">{error}</p>}</div><div className="modal-footer"><button type="button" className="button ghost" onClick={onClose}>Cancel</button><button type="submit" className={'button '+submitTone}>{label}{submitIcon&&<ArrowUpRight size={16}/>}</button></div></form>;
}
export function Field({label,children,hint}:{label:string;children:ReactNode;hint?:string}){return <label className="field"><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>;}
export function Empty({title,description,action}:{title:string;description:string;action?:ReactNode}){return <div className="empty-state"><span className="empty-icon"><Wallet size={28} strokeWidth={1.4}/></span><h3>{title}</h3><p>{description}</p>{action}</div>;}
export function Progress({value,label,tone='green'}:{value:number;label:string;tone?:string}){return <div className={'progress-track '+tone} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.max(0,Math.min(100,value)))}><span style={{width:Math.max(0,Math.min(100,value))+'%'}}/></div>;}
export function Hint({children}:{children:ReactNode}){return <div className="hint"><CircleHelp size={16}/><p>{children}</p></div>;}
