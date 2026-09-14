import {Leaf,LayoutList,Check} from 'lucide-react';
import type {AppAppearance} from './app-appearance';
import {Modal} from './ui';

export default function AppAppearanceDialog({value,onChange,onClose,remembered}:{value:AppAppearance;onChange:(value:AppAppearance)=>void;onClose:()=>void;remembered:boolean}){
 return <Modal title="App appearance" eyebrow="MAKE YOURSELF COMFORTABLE" className="modal-standard app-appearance-dialog" onClose={onClose}>
  <div className="form-body">
   <p className="appearance-intro">Choose your view. Your budget, goals and saved entries stay the same.</p>
   <fieldset className="appearance-choices"><legend>App view</legend>
    <label className="appearance-choice"><input type="radio" name="app-view" value="current" checked={value.view==='current'} onChange={()=>onChange({...value,view:'current'})}/><LayoutList size={22} aria-hidden="true"/><span><strong>Current view</strong><small>Default. Your familiar layout.</small></span></label>
    <label className="appearance-choice"><input type="radio" name="app-view" value="pip" checked={value.view==='pip'} onChange={()=>onChange({...value,view:'pip'})}/><Leaf size={22} aria-hidden="true"/><span><strong>Pip view</strong><small>Optional. Softer surfaces and gentle motion.</small></span></label>
   </fieldset>
   <label className="appearance-motion"><span><strong>Pip view motion</strong><small>Animate Pip and navigation. System Reduced Motion takes priority.</small></span><input type="checkbox" checked={value.motion} disabled={value.view!=='pip'} onChange={event=>onChange({...value,motion:event.target.checked})}/></label>
   <p className="appearance-storage" role="status">{remembered?'Your choice is remembered for your account in this browser. You can switch back at any time.':'Your choice applies to this page. Browser storage is unavailable, so it cannot be remembered after closing.'}</p>
  </div>
  <div className="modal-footer"><button type="button" className="button primary" onClick={onClose}>Done<Check size={16} aria-hidden="true"/></button></div>
 </Modal>;
}
