import {chmodSync,chownSync,lstatSync,mkdirSync,readFileSync} from 'node:fs';
import {selfHostedSecrets} from './self-hosted-secrets.mjs';

if(process.env.SPENTON_DEPLOYMENT_MODE!=='self-hosted')throw new Error('This entry point is only for self-hosting.');
process.umask(0o077);
const directory='/settings';
mkdirSync(directory,{recursive:true,mode:0o700});
if(lstatSync(directory).isSymbolicLink())throw new Error('Settings must use the configured volume.');
const secrets=selfHostedSecrets(directory);
if(process.getuid?.()===0){
 for(const path of [directory,directory+'/secrets.json']){chownSync(path,1000,1000);chmodSync(path,path===directory?0o700:0o600);}
}
process.env.BETTER_AUTH_SECRET=secrets.auth;
process.env.SPENTON_BACKUP_TOKEN=secrets.backup;
process.env.SPENTON_SOURCE_COMMIT=JSON.parse(readFileSync(new URL('../build-source.json',import.meta.url),'utf8')).sourceCommit;
await import(process.argv[2]==='backups'?'./backup-entry.mjs':'./container-entry.mjs');
