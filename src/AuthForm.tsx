import {localAccountPage,accountName} from './local-account';
import {useId,useState} from 'react';
import type {FormEvent} from 'react';
import {ArrowRight} from 'lucide-react';
import {api} from './cloud';
import type {CloudUser} from './cloud';
import {Field} from './ui';
import SocialSignIn from './SocialSignIn';
import LastUsedTag from './LastUsedTag';
import {useLastSignIn,rememberSuccessfulSignIn} from './last-signin';
import {EmailRequest} from './EmailRequest';
import EmailNotice from './EmailNotice';
const message=(error:unknown)=>error instanceof Error?error.message:'This request could not be completed.';

export function AuthForm({onSignedIn,existingUser,signInOnly=false,initialRegister=false}:{onSignedIn:(user:CloudUser)=>void;existingUser?:CloudUser;signInOnly?:boolean;initialRegister?:boolean}){
 const [register,setRegister]=useState(()=>initialRegister&&!existingUser&&!signInOnly),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[request,setRequest]=useState<'reset'|'verify'|null>(null);
 const [email,setEmail]=useState(existingUser?accountName(existingUser.email):'');
 const passwordId=useId(),lastMethod=useLastSignIn(existingUser);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy)return;setBusy(true);setError('');
  const form=new FormData(event.currentTarget);
  try{
   const response=await api<{user:CloudUser;verificationRequired?:boolean}>('/auth/'+(register?'register':'login'),{method:'POST',body:{...(localAccountPage?{username:existingUser?accountName(existingUser.email):String(form.get('username'))}:{email:existingUser?.email??String(form.get('email'))}),password:String(form.get('password'))}});
   if(response.verificationRequired){setNotice(String(form.get('email')));setRegister(false);return;}
   const {user}=response;
   if(existingUser&&user.id!==existingUser.id)throw new Error('Sign in to the original account to finish saving this budget.');
   rememberSuccessfulSignIn('password');onSignedIn(user);
  }catch(e){setError(message(e));}finally{setBusy(false);}
 }
 if(request)return <EmailRequest kind={request} email={email} onBack={()=>setRequest(null)}/>;
 return <form className="cloud-form auth-form" onSubmit={submit}>
  <header className="auth-heading"><span className="cloud-eyebrow">{existingUser?'RIGHT WHERE YOU LEFT OFF':register?'CREATE A SPENTON ACCOUNT':'YOUR SPENTON ACCOUNT'}</span><h1>{existingUser?'Sign in again.':register?'Create your account.':'Welcome back.'}</h1><p className="cloud-description">{existingUser?'Sign in to the same account to keep editing your draft.':register?'Create your account to start planning your money.':'Sign in to open your budgets.'}</p></header>
  {!localAccountPage&&<SocialSignIn existingUser={existingUser} onSignedIn={onSignedIn}/>}
  <div className="auth-email-heading" aria-label={(localAccountPage?'Username and password':'Email and password')+(!register&&lastMethod==='password'?', last used sign-in method':'')}><span>{localAccountPage?'Username & password':'Email & password'}</span>{!register&&lastMethod==='password'&&<LastUsedTag account={!!existingUser}/>}</div>
  <Field label={localAccountPage?'Username':'Email'}><input name={localAccountPage?'username':'email'} type={localAccountPage?'text':'email'} autoComplete="username" required maxLength={localAccountPage?40:254} value={email} onChange={event=>setEmail(event.target.value)} readOnly={!!existingUser} placeholder={localAccountPage?'alex':'you@example.com'}/></Field>
  <div className="auth-password-field"><div className="auth-password-heading"><label htmlFor={passwordId}>Password</label>{!register&&!localAccountPage&&<button type="button" className="text-button" onClick={()=>setRequest('reset')}>Forgot password?</button>}</div><input id={passwordId} name="password" type="password" autoComplete={register?'new-password':'current-password'} required minLength={12} maxLength={1024}/></div>
  {register&&<p className="auth-password-note">At least 12 characters. Your password manager can help you choose.</p>}
  {notice&&<EmailNotice email={notice} message="A verification email has been requested. Use the link to verify your address, then sign in."/>}{error&&<p role="alert" className="form-error">{error}</p>}
  <button className="button primary full auth-submit" disabled={busy}>{busy?'One moment…':register?'Create account':'Sign in'}<ArrowRight size={17}/></button>
  {!existingUser&&!signInOnly&&<div className="auth-switch"><button type="button" className="text-button" onClick={()=>{setRegister(!register);setError('');setNotice('');}}>{register?'Already have an account? Sign in':'New here? Create an account'}</button></div>}
  <details className="auth-help"><summary>Need help signing in?</summary>{localAccountPage?<p>Forgot your password? On the computer running SpentOn, run <code>docker compose -f self-hosted/compose.yaml exec app node self-hosted/reset-password.mjs</code>. No email is needed.</p>:<><p>Request a new verification email if yours has not arrived.</p><button type="button" className="text-button" onClick={()=>setRequest('verify')}>Resend verification email</button></>}</details>
  <p className="auth-privacy">{localAccountPage?'Your account and password belong to this installation. No email service is used.':'Your budgets are private.'} <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy notice</a></p>
 </form>;
}
