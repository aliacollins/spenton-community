import {useSyncExternalStore} from 'react';
import type {CloudUser} from './cloud';

export const SIGN_IN_METHODS=['password','google','microsoft','apple'] as const;
export type SignInMethod=typeof SIGN_IN_METHODS[number];
export const LAST_SIGN_IN_KEY='spenton.last-signin-method';
const CHANGE='spenton:signin-method';
const MAX_AGE=30*86400000;
export const isSignInMethod=(value:unknown):value is SignInMethod=>SIGN_IN_METHODS.includes(value as SignInMethod);

// A convenience hint only: no identity, credentials or budget data. Never used for authentication.
function browserMethod():SignInMethod|null{
 try{const value=JSON.parse(localStorage.getItem(LAST_SIGN_IN_KEY)??'null');return value&&isSignInMethod(value.method)&&Number.isSafeInteger(value.expiresAt)&&value.expiresAt>Date.now()&&value.expiresAt<=Date.now()+MAX_AGE?value.method:null;}catch{return null;}
}
function subscribe(callback:()=>void){
 const storage=(event:StorageEvent)=>{if(event.key===LAST_SIGN_IN_KEY||event.key===null)callback();};
 window.addEventListener('storage',storage);window.addEventListener(CHANGE,callback);
 return ()=>{window.removeEventListener('storage',storage);window.removeEventListener(CHANGE,callback);};
}
export function rememberSuccessfulSignIn(method:unknown){
 if(!isSignInMethod(method))return;
 try{localStorage.setItem(LAST_SIGN_IN_KEY,JSON.stringify({method,expiresAt:Date.now()+MAX_AGE}));}catch{/* Storage restrictions must never stop a sign-in. */}
 window.dispatchEvent(new Event(CHANGE));
}
export function forgetLastSignIn(){try{localStorage.removeItem(LAST_SIGN_IN_KEY);}catch{/* No storage is also fine. */}window.dispatchEvent(new Event(CHANGE));}
export function useLastSignIn(user?:CloudUser){
 const hint=useSyncExternalStore(subscribe,browserMethod,()=>null);
 // An authenticated identity must never inherit another account's browser hint.
 return user?(isSignInMethod(user.lastSignInMethod)?user.lastSignInMethod:null):hint;
}
