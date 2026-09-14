import LoadingState from './LoadingState';
import {useEffect,useRef,useState} from 'react';
import {api,CloudError} from './cloud';
import {AuthForm} from './AuthForm';
import {money} from './engine';
import './shared-expenses.css';

export type SharedBill={text:string;pages:string[]};
export function BillPages({bill}:{bill:SharedBill}){return <div className="shared-bill-pages">{bill.pages.map((page,index)=><img key={index} src={'data:image/jpeg;base64,'+page} alt={'Bill page '+(index+1)}/>)}<pre>{bill.text}</pre></div>;}
type Preview={merchant:string;total:number;currency:string;date:string;amount:number;received?:number;payer:string;name:string;receipt:SharedBill|null};

export default function ShareInvitation(){
 const [token]=useState(()=>new URLSearchParams(location.hash.slice(1)).get('token')??'');
 const [preview,setPreview]=useState<Preview|null>(null),[needsLogin,setNeedsLogin]=useState(false),[busy,setBusy]=useState(true),[error,setError]=useState(''),[done,setDone]=useState(false),[confirmed,setConfirmed]=useState(false);
 const operation=useRef(crypto.randomUUID());
 async function load(){setBusy(true);setError('');try{setPreview(await api<Preview>('/share-invitations/preview',{method:'POST',body:{token}}));setNeedsLogin(false);}catch(e){if(e instanceof CloudError&&e.status===401)setNeedsLogin(true);else setError(e instanceof Error?e.message:'The invitation could not be opened.');}finally{setBusy(false);}}
 useEffect(()=>{history.replaceState(null,'','/?share-invite');void load();},[]);
 async function claim(){setBusy(true);setError('');try{await api('/share-invitations/claim',{method:'POST',body:{token,operationId:operation.current,confirmRecipient:confirmed}});setDone(true);}catch(e){setError(e instanceof Error?e.message:'Your share could not be saved. Retry to confirm the same request.');}finally{setBusy(false);}}
 return <main className="account-action share-invitation"><a className="cloud-brand" href="/app"><img src="/brand/spenton-symbol.svg" alt=""/><span>SpentOn</span></a>
  <h1>{done?'Your share is in People':needsLogin?'You’ve been invited to a split':'Your share, ready to review'}</h1>
  {done?<><p>Open People in SpentOn to accept your share with a budget and record a repayment when you pay. No spending or payment has been added.</p><a className="button primary" href="/app?people">Open SpentOn</a></>:needsLogin?<><p>Sign in or create an account to see the bill and your amount. Only this share is added to your People page.</p><AuthForm onSignedIn={()=>void load()}/></>:preview?<>
   <p className="shared-invite-amount">{money(preview.amount,preview.currency)}</p><p>Your share of <strong>{preview.merchant}</strong></p>{(preview.received??0)>0&&<p>The payer recorded {money(preview.received!,preview.currency)} received. <strong>{money(preview.amount-preview.received!,preview.currency)} remains outstanding.</strong> Joining will not add that money again.</p>}
   <dl><div><dt>Bill total</dt><dd>{money(preview.total,preview.currency)}</dd></div><div><dt>Paid by</dt><dd>{preview.payer}</dd></div><div><dt>Date</dt><dd>{preview.date}</dd></div></dl>
   {preview.receipt&&<details><summary>View bill</summary><BillPages bill={preview.receipt}/></details>}
   <label className="shared-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} disabled={busy}/>This share is for me{preview.name?' ('+preview.name+')':''}.</label>
   <button className="button primary" disabled={busy||!confirmed} onClick={()=>void claim()}>Add to People</button><p className="small">You can accept or decline in SpentOn. This does not send money.</p>
  </>:busy?<LoadingState label="Opening your invitation"/>:null}
  {error&&<><p role="alert" className="form-error">{error}</p>{!preview&&<button className="button secondary" onClick={()=>void load()}>Try again</button>}</>}
 </main>;
}
