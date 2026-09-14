import { createServer } from 'vite';
import { resolve } from 'node:path';
import { createBudgetServer } from '../server/api.mjs';

const api=createBudgetServer({dbPath:resolve(process.env.SPENTON_DB_PATH||'server/data/spenton.sqlite'),deployment:process.env.SPENTON_DEPLOYMENT_MODE||'cloud',localAccounts:process.env.SPENTON_LOCAL_ACCOUNTS==='1',allowedOrigins:['http://127.0.0.1:5417']});
let vite;
let closing=false;
async function close(){if(closing)return;closing=true;await vite?.close();await api.close();}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void close().then(()=>process.exit(0)));
try{
 await api.listen(8787);
 vite=await createServer();await vite.listen();
 console.log('SpentOn account app: http://127.0.0.1:5417');
}catch(error){await close();throw error;}
