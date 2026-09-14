import { useState } from 'react';
import { CategoryIcon } from './ui';
import {starterSuggestions as suggestions,defaultStarters} from './starter-categories';
export {starterCategories,defaultStarters} from './starter-categories';
export default function StarterCategories({existing=[],initial=defaultStarters,compact=false}:{existing?:string[];initial?:string[];compact?:boolean}){
 const [selected,setSelected]=useState(initial.filter(name=>!existing.some(n=>n.toLowerCase()===name.toLowerCase())));
 return <div className="starter-categories"><p className={compact?"starter-selection-count":"muted"} aria-live={compact?"polite":undefined}>{compact?`${selected.length} selected · change these anytime`:"Pip’s starting suggestions. Pick what fits your life; you can add or change these anytime."}</p><div className="starter-groups">{[...new Set(suggestions.map(s=>s[0]))].map(group=><fieldset key={group}><legend>{group}</legend><div>{suggestions.filter(s=>s[0]===group).map(([,name,icon,color])=>{const added=existing.some(n=>n.toLowerCase()===name.toLowerCase());return <label key={name} className={selected.includes(name)?'chosen':''}><input type="checkbox" name="starter" value={name} disabled={added} checked={added||selected.includes(name)} onChange={e=>setSelected(e.target.checked?[...selected,name]:selected.filter(n=>n!==name))}/><CategoryIcon category={{icon,color}}/><span>{name}{added&&<small>Already added</small>}</span></label>;})}</div></fieldset>)}</div></div>;
}
