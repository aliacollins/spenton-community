/** Account-email delivery through the configured transport. */
export function createMailer({send:customSend,remindersAvailable,welcomeAvailable}={}){
 const available=typeof customSend==='function';const pending=new Set();let failed=0;
 async function deliver(message){if(!available)throw new Error('Account email is not configured.');return customSend(message);}
 function send(message){
  if(!available)throw new Error('Account email is not configured.');
  const job=new Promise(resolve=>setImmediate(resolve)).then(()=>deliver(message)).catch(()=>{failed++;}).finally(()=>pending.delete(job));pending.add(job);
 }
 return {available,remindersAvailable:available&&(remindersAvailable??true),welcomeAvailable:available&&(welcomeAvailable??true),send,deliver,drain:()=>Promise.allSettled([...pending]),health:()=>({pending:pending.size,failed})};
}
