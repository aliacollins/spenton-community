import Select from './Select';
import {CategoryIcon} from './ui';
import type { Category } from './engine';

export default function CategoryPicker({label,value,categories,groups=[],onChange}:{label:string;value:string;categories:Category[];groups?:string[];onChange:(id:string)=>void}){
 const groupNames=[...new Set([...groups,...categories.map(c=>c.group)])];
 return <Select className="category-select" searchable renderIcon={value=>{const category=categories.find(c=>c.id===value);return category?<CategoryIcon category={category} size={16}/>:null;}} aria-label={label} required value={categories.some(c=>c.id===value)?value:''} onChange={event=>onChange(event.target.value)}>
  <option value="" disabled>Choose a category</option>
  {groupNames.filter(group=>categories.some(c=>c.group===group)).map(group=><optgroup key={group} label={group}>{categories.filter(c=>c.group===group).map(category=>{
   const parent=categories.find(c=>c.id===category.parentId);
   return <option key={category.id} value={category.id}>{parent?parent.name+' / '+category.name:category.name}</option>;
  })}</optgroup>)}
 </Select>;
}
