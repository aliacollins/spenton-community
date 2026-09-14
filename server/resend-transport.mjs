import { createHash } from 'node:crypto';
const ACCOUNT_FROM='SpentOn Accounts <accounts@notify.spenton.dev>';
const UPDATES_FROM='Pip at SpentOn <hello@updates.spenton.dev>';
const sleepDefault=ms=>new Promise(resolve=>setTimeout(resolve,ms));

/** Server-only, domain-separated delivery. Never expose provider payloads in errors. */
export function createResendEmailOptions(env=process.env,{fetchImpl=globalThis.fetch,sleep=sleepDefault,now=Date.now,spacingMs=600}={}){
 if(env.SPENTON_RESEND_ENABLED!=='1')return {};
 const selfHosted=env.SPENTON_DEPLOYMENT_MODE==='self-hosted';
 const accountFrom=selfHosted?(env.SPENTON_MAIL_FROM??'').trim():ACCOUNT_FROM;
 const updatesFrom=selfHosted?accountFrom:UPDATES_FROM;
 const replyTo=selfHosted?(env.SPENTON_MAIL_REPLY_TO??'').trim():'support@spenton.dev';
 const address=value=>/^(?:[^<>\r\n]{1,80} <)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/.test(value);
 if(selfHosted&&(!address(accountFrom)||!address(replyTo)))throw new Error('Self-hosted email requires your verified sender and reply-to addresses.');
 const accountKey=(env.SPENTON_RESEND_ACCOUNT_API_KEY??'').trim(),updatesKey=(env.SPENTON_RESEND_UPDATES_API_KEY??'').trim();
 const validKey=key=>/^re_[A-Za-z0-9_-]{12,200}$/.test(key);
 if(!validKey(accountKey)||(updatesKey&&!validKey(updatesKey)))throw new Error('Configure valid domain-restricted email credentials.');
 if(updatesKey&&updatesKey===accountKey)throw new Error('Account and update emails require separate credentials.');
 const origin=new URL((env.SPENTON_ALLOWED_ORIGINS??'').split(',')[0].trim());
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('Email links require a trusted HTTPS origin.');
 const welcomeSince=Number(env.SPENTON_EMAIL_ACTIVATED_AT??(selfHosted?now():undefined));
 if(!Number.isSafeInteger(welcomeSince)||welcomeSince<=0)throw new Error('Configure the email activation timestamp.');
 const postalAddress=(env.SPENTON_POSTAL_ADDRESS??'').trim();
 let queue=Promise.resolve(),lastAttempt=0;
 async function send(message){
  const channel=message.channel??'account';
  if(!['account','welcome','reminder'].includes(channel))throw new Error('Unknown email channel.');
  const key=channel==='account'?accountKey:updatesKey;
  if(!key)throw new Error('This email channel is not configured.');
  if(channel==='reminder'&&!postalAddress)throw new Error('Reminder contact details are not configured.');
  if(typeof message.to!=='string'||message.to.length>254||!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(message.to))throw new Error('Invalid email recipient.');
  if(typeof message.id!=='string'||!message.id||message.id.length>256)throw new Error('Email delivery requires an identifier.');
  if(typeof message.subject!=='string'||/[\r\n]/.test(message.subject)||message.subject.length>200||typeof message.html!=='string'||typeof message.text!=='string'||message.html.length+message.text.length>200000)throw new Error('Invalid email content.');
  const headers={};
  if(channel==='reminder'){
   const list=message.headers?.['List-Unsubscribe'],post=message.headers?.['List-Unsubscribe-Post'];
   if(typeof list!=='string'||!list.startsWith('<'+origin.origin+'/api/email/one-click?token=')||!/^<https:\/\/[^<>\s]+>$/.test(list)||post!=='List-Unsubscribe=One-Click')throw new Error('Reminder emails require valid unsubscribe controls.');
   headers['List-Unsubscribe']=list;headers['List-Unsubscribe-Post']=post;
  }
  // Enumerate fields: callers cannot change sender, reply-to, credentials or add recipients.
  const body=JSON.stringify({from:channel==='account'?accountFrom:updatesFrom,to:[message.to],reply_to:replyTo,subject:message.subject,html:message.html,text:message.text,...(channel==='reminder'?{headers}:{})});
  const idempotency='spenton-'+createHash('sha256').update(channel+':'+message.id).digest('hex');
  const job=queue.then(async()=>{
   for(let attempt=0;attempt<3;attempt++){
    const gap=lastAttempt+spacingMs-now();if(gap>0)await sleep(gap);lastAttempt=now();
    let response;
    try{response=await fetchImpl('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':idempotency},body});}
    catch{if(attempt<2){await sleep(500*(2**attempt));continue;}throw new Error('Email delivery could not reach the provider.');}
    if(response.ok){
     try{const result=await response.json();if(typeof result.id!=='string'||result.id.length>100)throw new Error();return {id:result.id};}
     catch{throw new Error('Email provider returned an invalid delivery receipt.');}
    }
    await response.body?.cancel().catch(()=>{});
    if((response.status===429||response.status>=500)&&attempt<2){await sleep(500*(2**attempt));continue;}
    throw new Error('Email delivery was not accepted by the provider (HTTP '+response.status+').');
   }
  });
  queue=job.catch(()=>{});return job;
 }
 return {send,remindersAvailable:!!updatesKey,welcomeAvailable:!!updatesKey,postalAddress,welcomeSince};
}
