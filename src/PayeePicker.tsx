import {useId} from 'react';
import {UserRound} from 'lucide-react';
import SuggestionInput from './SuggestionInput';

export default function PayeePicker({label='Payee',value,payees,onChange,autoFocus=false,name,placeholder='Choose or type a payee'}:{label?:string;value:string;payees:string[];onChange:(value:string)=>void;autoFocus?:boolean;name?:string;placeholder?:string}){
 const id=useId(),query=value.trim().toLocaleLowerCase(),existing=payees.some(payee=>payee.toLocaleLowerCase()===query);
 return <div className="payee-picker"><SuggestionInput label={label} value={value} options={payees} onChange={onChange} name={name} autoFocus={autoFocus} placeholder={placeholder} required maxLength={160} menuLabel="Saved payees" initials leadingIcon={<UserRound size={17} aria-hidden="true"/>} aria-describedby={id} emptyLabel={payees.length?'No matches. Type a new payee name.':'Saved payees will appear here after your first transaction.'}/>
  <small className="payee-helper" id={id}>{query&&!existing?'New payee. Reusable after you save this transaction.':payees.length?payees.length+' saved '+(payees.length===1?'payee':'payees')+' in this budget. Choose one or type a new name.':'Type your first payee. It will be reusable in this budget after saving.'}</small>
 </div>;
}
