import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,linkSync,unlinkSync,lstatSync,constants,openSync,closeSync} from 'node:fs';
import {join} from 'node:path';

export function selfHostedSecrets(directory){
 mkdirSync(directory,{recursive:true,mode:0o700});
 if(lstatSync(directory).isSymbolicLink())throw new Error('Settings must use a real directory.');
 const file=join(directory,'secrets.json'),temporary=join(directory,'.secrets-'+randomUUID());
 try{
  writeFileSync(temporary,JSON.stringify({auth:randomBytes(48).toString('base64url'),backup:randomBytes(32).toString('hex')}),{mode:0o600,flag:'wx'});
  try{linkSync(temporary,file);}catch(e){if(e.code!=='EEXIST')throw e;}
 }finally{try{unlinkSync(temporary);}catch{}}
 const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const values=JSON.parse(readFileSync(fd,'utf8'));
  if(!/^[A-Za-z0-9_-]{64}$/.test(values.auth)||!/^[a-f0-9]{64}$/.test(values.backup))throw new Error('Invalid persistent settings. Restore the original settings volume.');
  return values;
 }finally{closeSync(fd);}
}
