import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import react from '@vitejs/plugin-react';
import deployment from './vercel.json';

// Exercise the same public entry rewrites in development and browser tests.
type EntryRewrite={source:string;destination:string;missing?:{type:string;key:string}[]};
const entryRewrites:EntryRewrite[]=deployment.rewrites.filter(rule=>rule.source==='/'||rule.source==='/app');
function rewriteEntry(req:IncomingMessage,_res:ServerResponse,next:()=>void){
 const url=new URL(req.url??'/','http://preview.invalid');
 if(req.method==='GET'||req.method==='HEAD'){
  if(process.env.SPENTON_DEPLOYMENT_MODE==='self-hosted'&&url.pathname==='/'){req.url='/index.html'+url.search;next();return;}
  const rule=entryRewrites.find(rule=>rule.source===url.pathname&&!(rule.missing??[]).some(condition=>condition.type==='query'&&url.searchParams.has(condition.key)));
  if(rule)req.url=rule.destination+url.search;
 }
 next();
}
const publicEntryRouting:Plugin={name:'public-entry-routing',configureServer(server){server.middlewares.use(rewriteEntry);},configurePreviewServer(server){server.middlewares.use(rewriteEntry);},transformIndexHtml(html){return process.env.SPENTON_DEPLOYMENT_MODE==='self-hosted'?html.replace('</head>','<meta name="spenton-deployment" content="self-hosted"></head>'):html;}};
// Every entry shares the authenticated API origin. Even a marketing-page script
// could read signed-in budgets through same-origin fetch. The current product has
// no optional trackers; keep its existing essential-cookie settings UI first-party.
// A third-party consent manager belongs on a separately isolated marketing origin.
export default defineConfig({plugins:[publicEntryRouting,react()],server:{host:'127.0.0.1',port:5417,strictPort:true,proxy:{'/api':{target:process.env.SPENTON_DEV_API_URL??'http://127.0.0.1:8787',changeOrigin:false}}},build:{rollupOptions:{input:{selfHosting:'learn/self-hosting/index.html',app:'index.html',landing:'landing/index.html',learn:'learn/index.html',tryExample:'learn/try/index.html',sharedExpenses:'learn/shared-expenses/index.html',envelopeBudgeting:'learn/envelope-budgeting/index.html',creditCardPayments:'learn/credit-card-payments/index.html'}}}});
