import {useState} from 'react';
import type {FormEvent} from 'react';
import {api} from './cloud';
import {Field} from './ui';
import EmailNotice from './EmailNotice';
const problem=(e:unknown)=>e instanceof Error?e.message:'This request could not be completed.';
export function EmailRequest({kind,email='',onBack}:{kind:'reset'|'verify';email?:string;onBack:()=>void}){
 const [recipient,setRecipient]=useState(email);
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');const data=new FormData(event.currentTarget);try{const result=await api<{message:string}>('/auth/'+(kind==='reset'?'request-reset':'send-verification'),{method:'POST',body:{email:data.get('email')}});setRecipient(String(data.get('email')));setNotice(result.message);}catch(e){setError(problem(e));}finally{setBusy(false);}}
 return <form className="cloud-form" onSubmit={submit}><span className="cloud-eyebrow">ACCOUNT SECURITY</span><h1>{kind==='reset'?'Let’s get you back in.':'Verify your email.'}</h1><p className="cloud-description">{kind==='reset'?'We’ll send a link to choose a new password. Your budgets stay safe.':'We’ll send a link to confirm this address belongs to you.'}</p><Field label="Email"><input name="email" type="email" autoComplete="email" required maxLength={254} defaultValue={email}/></Field>{notice&&<EmailNotice email={recipient} message={notice}/>}{error&&<p role="alert" className="form-error">{error}</p>}<button className="button primary full" disabled={busy}>{busy?'One moment…':kind==='reset'?'Send reset link':'Send verification email'}</button><button className="text-button" type="button" onClick={onBack}>Back to sign in</button></form>;
}
