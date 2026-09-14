export const localAccountPage=document.querySelector('meta[name="spenton-local-accounts"]')?.getAttribute('content')==='true';
export function accountName(email:string){return localAccountPage&&email.endsWith('@local.spenton.invalid')?email.slice(0,-'@local.spenton.invalid'.length):email;}
