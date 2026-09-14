import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBudgetServer} from './api.mjs';
import {createBackupClient} from './backup-client.mjs';
import {createResendEmailOptions} from './resend-transport.mjs';

test('self-hosted static routing serves only built assets and keeps account operations on the API',async t=>{
 const root=await mkdtemp(join(tmpdir(),'spenton-static-')),dist=join(root,'dist');
 await mkdir(dist);await mkdir(join(dist,'assets'));
 await writeFile(join(dist,'index.html'),'<html><head></head><body>SpentOn app</body></html>');
 await writeFile(join(dist,'assets','app-123abc.js'),'window.ready=true;');
 await writeFile(join(root,'private.txt'),'must not be served');
 await symlink(join(root,'private.txt'),join(dist,'leak.txt'));
 const app=createBudgetServer({dbPath:join(root,'data.sqlite'),deployment:'self-hosted',staticDirectory:dist,authSecret:'fictional-static-test-secret-12345678901234567890'});
 const address=await app.listen(0),base=`http://127.0.0.1:${address.port}`;
 t.after(async()=>{await app.close();await rm(root,{recursive:true,force:true});});
 for(const path of ['/','/app','/privacy','/terms','/?account-action=verify']){
  const response=await fetch(base+path);
  assert.equal(response.status,200);
  assert.match(await response.text(),/name="spenton-deployment" content="self-hosted"/);
  assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow');
 }
 for(const path of ['/leak.txt','/.env','/%2e%2e/private.txt','/unknown'])assert.equal((await fetch(base+path)).status,404);
 assert.equal((await fetch(base+'/api/budgets')).status,401);
 assert.equal((await fetch(base+'/api/server')).status,200);
 assert.match(await (await fetch(base+'/robots.txt')).text(),/Disallow: \//);
 assert.equal((await fetch(base+'/assets/app-123abc.js')).headers.get('cache-control'),'public, max-age=31536000, immutable');
 assert.equal((await fetch(base+'/app',{method:'POST'})).status,405);
});

test('self-hosted backup routing permits only the configured private receiver',()=>{
 const options={url:'http://backups:8790',privateServiceHost:'backups',token:'a'.repeat(64),sourceCommit:'b'.repeat(40),appVersion:'0.3.0',dbPath:'/fictional/db.sqlite'};
 assert.doesNotThrow(()=>createBackupClient(options));
 assert.throws(()=>createBackupClient({...options,privateServiceHost:undefined}),/Invalid private backup/);
 assert.throws(()=>createBackupClient({...options,url:'http://external.example'}),/Invalid private backup/);
 assert.throws(()=>createBackupClient({...options,url:'http://backups:8790/path'}),/Invalid private backup/);
});

test('self-hosted email uses the operator sender, never SpentOn Cloud addresses',async()=>{
 let sent;
 const env={SPENTON_DEPLOYMENT_MODE:'self-hosted',SPENTON_RESEND_ENABLED:'1',SPENTON_RESEND_ACCOUNT_API_KEY:'re_fictionalselfhostkey123',SPENTON_ALLOWED_ORIGINS:'https://budget.example.test',SPENTON_MAIL_FROM:'Household <accounts@example.test>',SPENTON_MAIL_REPLY_TO:'owner@example.test'};
 const options=createResendEmailOptions(env,{fetchImpl:async(_url,request)=>{sent=JSON.parse(request.body);return new Response(JSON.stringify({id:'fictional'}));},spacingMs:0});
 await options.send({id:'fictional-message',to:'person@example.test',subject:'Verify account',html:'<p>Test</p>',text:'Test'});
 assert.equal(sent.from,env.SPENTON_MAIL_FROM);assert.equal(sent.reply_to,env.SPENTON_MAIL_REPLY_TO);
 assert.throws(()=>createResendEmailOptions({...env,SPENTON_MAIL_FROM:''}),/verified sender/);
});
