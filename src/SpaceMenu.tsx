import { useEffect, useRef } from 'react';
import { ChevronDown, LogOut } from 'lucide-react';
import type { CloudUser } from './cloud';
import type { BillingStatus } from './AccessPanel';
import { accessLabel } from './AccessPanel';
export default function SpaceMenu({user,budget,billing,onWorkspace,onSettings,onAppearance,onAccount,onPlan,onSignOut}:{user:CloudUser;budget:string;billing:BillingStatus|null;onWorkspace:()=>void;onSettings:()=>void;onAppearance:()=>void;onAccount:()=>void;onPlan:()=>void;onSignOut:()=>void}){
 const ref=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{const outside=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node)&&ref.current)ref.current.open=false;};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);},[]);
 const run=(action:()=>void)=>{if(ref.current)ref.current.open=false;action();};
 return <details ref={ref} className="space-menu" onKeyDown={e=>{if(e.key==='Escape'&&ref.current){ref.current.open=false;ref.current.querySelector('summary')?.focus();}}}><summary className="workspace-switch" aria-label="Personal space menu"><span className="workspace-avatar">{user.email.charAt(0).toUpperCase()}</span><span><strong>Personal space</strong><small>{budget}</small></span><ChevronDown size={15}/></summary><div className="space-menu-panel"><small>{user.email}</small><button onClick={()=>run(onWorkspace)}>Budgets & account</button><button onClick={()=>run(onSettings)}>Budget settings</button><button onClick={()=>run(onAppearance)}>App appearance</button><button onClick={()=>run(onAccount)}>Account & privacy</button><button onClick={()=>run(onPlan)}>Your plan{billing&&<small>{accessLabel(billing)}</small>}</button><button onClick={()=>run(onSignOut)}>Sign out<LogOut size={15}/></button></div></details>;
}
