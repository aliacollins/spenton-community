import {createContext,useCallback,useContext,useEffect,useId,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {CircleAlert} from 'lucide-react';
import {Modal} from './ui';

type Choice={title:string;description:string;confirmLabel:string;cancelLabel?:string;destructive?:boolean};
type Presented=Choice&{opener:HTMLElement|null;key:number};
type Pending={owner:string;resolve:(confirmed:boolean)=>void};
type Controller={ask:(owner:string,choice:Choice)=>Promise<boolean>;cancel:(owner:string)=>void};
const Context=createContext<Controller|null>(null);

export function ConfirmationProvider({children}:{children:ReactNode}){
 const pending=useRef<Pending|null>(null),[choice,setChoice]=useState<Presented|null>(null),descriptionId=useId(),cancelButton=useRef<HTMLButtonElement>(null),clicked=useRef<HTMLElement|null>(null),serial=useRef(0);
 useEffect(()=>{
  let reset:ReturnType<typeof setTimeout>|undefined;
  // Safari does not focus a button on pointer click. Remember this event's
  // actual control so closing the decision can still return useful focus.
  const remember=(event:MouseEvent)=>{
   clicked.current=event.target instanceof Element?event.target.closest<HTMLElement>('button,[role="button"],a,input'):null;
   clearTimeout(reset);reset=setTimeout(()=>{clicked.current=null;},0);
  };
  document.addEventListener('click',remember,true);
  return()=>{clearTimeout(reset);document.removeEventListener('click',remember,true);};
 },[]);
 const settle=useCallback((confirmed:boolean,owner?:string)=>{
  const current=pending.current;
  if(!current||owner&&owner!==current.owner)return;
  pending.current=null;setChoice(null);current.resolve(confirmed);
 },[]);
 const cancel=useCallback((owner:string)=>settle(false,owner),[settle]);
 const ask=useCallback((owner:string,next:Choice)=>new Promise<boolean>(resolve=>{
  // A second click must not replace the request being reviewed.
  if(pending.current){resolve(false);return;}
  pending.current={owner,resolve};setChoice({...next,opener:clicked.current??(document.activeElement instanceof HTMLElement?document.activeElement:null),key:serial.current++});
 }),[]);
 useEffect(()=>()=>{const current=pending.current;pending.current=null;current?.resolve(false);},[]);
 return <Context.Provider value={{ask,cancel}}>{children}{choice&&<Modal key={choice.key} title={choice.title} role="alertdialog" descriptionId={descriptionId} initialFocus={cancelButton} returnFocus={choice.opener} className="spenton-confirmation" onClose={()=>settle(false)}>
  <div className="form-body"><CircleAlert className="confirmation-symbol" size={28} aria-hidden="true"/><p id={descriptionId}>{choice.description}</p></div>
  <div className="modal-footer"><button ref={cancelButton} type="button" className="button ghost" onClick={()=>settle(false)}>{choice.cancelLabel??'Cancel'}</button><button type="button" className={'button '+(choice.destructive?'danger':'primary')} onClick={()=>settle(true)}>{choice.confirmLabel}</button></div>
 </Modal>}</Context.Provider>;
}

export function useConfirmation(){
 const controller=useContext(Context),owner=useId();
 if(!controller)throw new Error('ConfirmationProvider is required.');
 const {ask,cancel}=controller;
 useEffect(()=>()=>cancel(owner),[cancel,owner]);
 return useCallback((choice:Choice)=>ask(owner,choice),[ask,owner]);
}
