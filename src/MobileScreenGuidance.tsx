import {useId,useState} from 'react';
import {Monitor} from 'lucide-react';
import './mobile-screen-guidance.css';

const dismissalKey='spenton.mobile-screen-guidance.v1';

export default function MobileScreenGuidance(){
 const headingId=useId();
 const [dismissed,setDismissed]=useState(()=>{
  try{return sessionStorage.getItem(dismissalKey)==='dismissed';}
  catch{return false;}
 });
 if(dismissed)return null;
 return <aside className="mobile-screen-guidance" aria-labelledby={headingId}>
  <Monitor size={24} aria-hidden="true"/>
  <div>
   <h2 id={headingId}>Try a larger screen</h2>
   <p>Open SpentOn on a tablet or computer for a clearer view of your budget.</p>
   <button type="button" onPointerDown={event=>event.preventDefault()} onClick={event=>{
    // Keep an active inline editor focused; keyboard dismissal returns to the page.
    if(document.activeElement===event.currentTarget)event.currentTarget.closest('main')?.focus({preventScroll:true});
    setDismissed(true);
    try{sessionStorage.setItem(dismissalKey,'dismissed');}
    catch{/* The optional tip stays dismissed in memory if storage is unavailable. */}
   }}>Continue on mobile</button>
  </div>
 </aside>;
}
