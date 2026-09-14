import { useEffect, useRef, useState } from 'react';
import { api } from './cloud';
import type { CloudUser } from './cloud';
import './social-signin.css';
import {KeyRound} from 'lucide-react';
import LastUsedTag from './LastUsedTag';
import {useLastSignIn,rememberSuccessfulSignIn} from './last-signin';

type Provider={id:string;name:string;available:boolean};
export function ProviderIcon({provider}:{provider:string}){
 if(provider==='microsoft')return <svg className="provider-icon provider-microsoft" viewBox="0 0 20 20" aria-hidden="true"><path fill="#f25022" d="M1 1h8v8H1z"/><path fill="#7fba00" d="M11 1h8v8h-8z"/><path fill="#00a4ef" d="M1 11h8v8H1z"/><path fill="#ffb900" d="M11 11h8v8h-8z"/></svg>;
 if(provider==='apple')return <svg className="provider-icon provider-apple" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.3 2c.2 1.5-.5 2.9-1.3 3.8-.9 1-2.3 1.7-3.6 1.6-.2-1.4.5-2.8 1.4-3.7.9-1 2.4-1.6 3.5-1.7ZM20.6 17.2c-.5 1.2-.8 1.7-1.5 2.8-1.1 1.5-2.6 3.4-4.5 3.4-1.7 0-2.1-1.1-4.4-1.1-2.2 0-2.7 1.1-4.4 1.1-1.8 0-3.3-1.7-4.4-3.2C-1.5 16.1.2 9.4 3.9 8.1c1.9-.7 3.4.4 4.9.4 1.4 0 3.1-1.2 5.3-.5 1.3.4 2.2 1.1 2.9 2-2.7 1.6-2.3 5.6 1.1 6.9l2.5.3Z" transform="translate(3 0) scale(.8)"/></svg>;
 if(provider!=='google')return <KeyRound className="provider-icon" aria-hidden="true"/>;
 return <svg className="provider-icon provider-google" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285f4" d="M22 12.2c0-.7-.1-1.4-.2-2.2H12v4.1h5.6a4.8 4.8 0 0 1-2.1 3.2v2.6h3.4c2-1.9 3.1-4.5 3.1-7.7Z"/><path fill="#34a853" d="M12 22c2.8 0 5.1-.9 6.9-2.5l-3.4-2.6a6.3 6.3 0 0 1-9.3-3H2.7v2.7A10 10 0 0 0 12 22Z"/><path fill="#fbbc05" d="M6.2 13.9a6 6 0 0 1 0-3.8V7.4H2.7a10 10 0 0 0 0 9.2l3.5-2.7Z"/><path fill="#ea4335" d="M12 6c1.6 0 3 .5 4.1 1.6l3.1-3A10 10 0 0 0 2.7 7.4l3.5 2.7A6 6 0 0 1 12 6Z"/></svg>;
}

export default function SocialSignIn({onSignedIn,existingUser,connect=false}:{onSignedIn:(user:CloudUser)=>void;existingUser?:CloudUser;connect?:boolean}){
 const [providers,setProviders]=useState<Provider[]>([]),[connected,setConnected]=useState<string[]>([]),[busy,setBusy]=useState(''),[error,setError]=useState('');
 const lastMethod=useLastSignIn(existingUser);
 const cleanup=useRef<(()=>void)|null>(null);
 useEffect(()=>{let active=true;void api<{providers:Provider[]}>('/auth/providers').then(data=>{if(active)setProviders(data.providers);}).catch(()=>{});if(connect)void api<{providers:string[]}>('/auth/connections').then(data=>{if(active)setConnected(data.providers);}).catch(()=>{});return()=>{active=false;cleanup.current?.();};},[connect]);
 async function start(provider:Provider){
  if(busy)return;setError('');
  const popupId=crypto.randomUUID(),popup=window.open('about:blank','spenton-'+popupId,'popup,width=520,height=720');
  if(!popup){setError('Allow the sign-in window to open, then try again.');return;}
  popup.opener=null;
  setBusy(provider.name);
  const channel=new BroadcastChannel('spenton-auth-'+popupId);
  const stop=()=>{clearTimeout(timeout);channel.close();popup.close();cleanup.current=null;setBusy('');};
  const timeout=setTimeout(()=>{stop();setError('Sign-in timed out. Please try again.');},5*60000);
  cleanup.current=stop;
  channel.onmessage=async event=>{
   if(event.data?.type!=='auth-complete')return;
   stop();
   if(event.data.error){setError('Provider sign-in could not finish. If you already have an account, sign in with your existing method and connect this provider from Sign-in methods.');return;}
   try{
    const {user}=await api<{user:CloudUser}>('/auth/me');
    if(existingUser&&user.id!==existingUser.id){await api('/auth/logout',{method:'POST'});throw new Error('Use the sign-in method connected to '+existingUser.email+'. Your budget draft is still here.');}
    if(connect){const data=await api<{providers:string[]}>('/auth/connections');setConnected(data.providers);if(!data.providers.includes(provider.id))throw new Error('The provider was not connected. Try again.');}
    else {rememberSuccessfulSignIn(user.lastSignInMethod);onSignedIn(user);}
   }catch(cause){setError(cause instanceof Error?cause.message:'Could not confirm sign-in.');}
  };
  try{const result=await api<{url:string}>(connect?'/auth/connect':'/auth/social',{method:'POST',body:{provider:provider.id,popupId}});popup.location.replace(result.url);}
  catch(cause){stop();setError(cause instanceof Error?cause.message:'Could not start sign-in.');}
 }
 const available=providers.filter(p=>p.available);
 if(!available.length&&!connect)return null;
 return <div className="social-signin">{connect&&connected.includes('credential')&&<div className="connected-password" aria-label={lastMethod==='password'?'Email and password, last used sign-in method':'Email and password'}><KeyRound/><span>Email &amp; password</span>{lastMethod==='password'&&<LastUsedTag account/>}</div>}{connect&&!available.length&&<p className="muted">More sign-in options will be here when they’re ready.</p>}{available.map(provider=><button className="social-signin-button" type="button" key={provider.id} data-last-used={lastMethod===provider.id} aria-label={connected.includes(provider.id)?provider.name+' connected':(connect?'Connect ':'Continue with ')+provider.name} aria-description={lastMethod===provider.id?'Last used sign-in method':undefined} disabled={!!busy||connected.includes(provider.id)} onClick={()=>void start(provider)}><ProviderIcon provider={provider.id}/><span>{connected.includes(provider.id)?provider.name+' connected':(connect?'Connect ':'Continue with ')+provider.name}</span>{lastMethod===provider.id&&<LastUsedTag account={!!existingUser}/>}</button>)}{busy&&<div className="social-signin-status" role="status">Continue in the {busy} window.<button type="button" className="text-button" onClick={()=>cleanup.current?.()}>Cancel sign-in</button></div>}{error&&<p role="alert" className="form-error">{error}</p>}{!connect&&<div className="social-signin-divider"><span>or use email</span></div>}</div>;
}

export function AuthCompletion(){
 const error=new URLSearchParams(location.search).get('auth')!=='complete';
 useEffect(()=>{const id=new URLSearchParams(location.search).get('popup');if(id&&/^[0-9a-f-]{36}$/.test(id)){const channel=new BroadcastChannel('spenton-auth-'+id);channel.postMessage({type:'auth-complete',error});channel.close();}else if(!error)window.close();},[error]);
 return <main className="auth-completion"><img src="/brand/spenton-symbol.svg" alt="SpentOn"/><h1>{error?'Sign-in could not finish':'You’re signed in'}</h1><p>{error?'Return to SpentOn and try again. Use your existing sign-in method if this provider is not connected.':'Return to your SpentOn window to continue.'}</p><button className="button primary" onClick={()=>window.close()}>Close this window</button></main>;
}
