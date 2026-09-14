import {useState} from 'react';
import Select from './Select';
import {Field,IconPicker} from './ui';

const colors=['sage','sand','blue','butter','lavender','peach','rose'];

export default function CategoryAppearance({initialIcon,initialColor='sage'}:{initialIcon?:string;initialColor?:string}){
 const [color,setColor]=useState(initialColor);
 return <section className="category-appearance-fields" aria-label="Category appearance">
  <h3>Icon and color</h3>
  <IconPicker initial={initialIcon} color={color}/>
  <Field label="Color"><Select name="color" value={color} onChange={event=>setColor(event.target.value)} renderIcon={value=><span className={'category-icon category-color-swatch '+value} aria-hidden="true"><i/></span>}>
   {colors.map(value=><option key={value} value={value}>{value.charAt(0).toUpperCase()+value.slice(1)}</option>)}
  </Select></Field>
 </section>;
}
