import {allocate,calculate,monthEnd,thisMonth,validateBudget} from './engine';
import type {Budget} from './engine';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import PipCompanion from './PipCompanion';
import './landing-shared-example';
const pipRoot=document.getElementById('pip-landing-root');
if(pipRoot)createRoot(pipRoot).render(createElement(PipCompanion));
const month=thisMonth(),date=month+'-01';
function sampleBudget():Budget{
 let budget:Budget={version:1,name:'Landing example',currency:'USD',demo:true,accounts:[{id:'cash',name:'Cash',type:'checking',opening:320000,date,lastFour:''},{id:'card',name:'Card',type:'credit',opening:-25000,date,lastFour:''}],categories:[
 {id:'home',name:'Home & bills',group:'Your priorities',icon:'home',color:'sage',target:185000,targetType:'monthly'},
 {id:'groceries',name:'Groceries',group:'Your priorities',icon:'basket',color:'sage',target:40000,targetType:'monthly'},
 {id:'annual',name:'Annual insurance',group:'Your priorities',icon:'repeat',color:'sage',target:120000,targetType:'balance'},
 {id:'buffer',name:'Next month',group:'Your priorities',icon:'umbrella',color:'sage',target:100000,targetType:'balance'}],entries:[]};
 for(const [category,amount] of [['home',185000],['groceries',40000],['annual',50000],['card:card',25000]] as const)budget=allocate(budget,'ready',category,amount,date);
 return budget;
}
let budget=sampleBudget(),step=0;
const dollars=(value:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100);
const setText=(id:string,text:string)=>{const node=document.getElementById(id);if(node)node.textContent=text;};
const chapters=[
 {label:'01 · PLAN YOUR MONEY',title:'Plan your available money.',description:'You have $3,200 in the bank and $200 available to plan. Set it aside for Groceries.',action:'Plan the last $200'},
 {label:'02 · PREPARE FOR LATER',title:'The annual bill is a monthly habit.',description:'A $1,200 insurance renewal is $100 a month. Move $100 from Groceries into Annual insurance to prepare for it.',action:'Set aside $100 for insurance'},
 {label:'03 · ADJUST THE PLAN',title:'Cover an unexpected expense.',description:'A bill costs $75 more than expected. Move $75 from Groceries to Home & bills, then record the extra expense.',action:'Cover the extra $75 bill'},
 {label:'04 · BUILD BREATHING ROOM',title:'Give next month a head start.',description:'The current bills have their money. Set aside another $100 from Groceries for next month. It will carry forward.',action:'Put $100 toward next month'},
 {label:'YOUR UPDATED BUDGET',title:'Your money is planned.',description:'You planned today’s money, prepared for an annual bill, adjusted for a surprise, and started a buffer for next month.',action:'Try the method again'}
];
function render(){
 const totals=calculate(budget,month);
 setText('demo-ready',dollars(totals.ready));setText('demo-cash',dollars(totals.cash));setText('demo-reserve',dollars(totals.cards.card.reserve));setText('demo-spent',dollars(totals.spent));setText('demo-owed',dollars(totals.cards.card.owed));
 for(const category of ['home','groceries','annual','buffer']){const prefix=category==='groceries'?'grocery':category;setText('demo-'+prefix+'-plan',dollars(totals.categories[category].assigned));setText('demo-'+prefix+'-spent',dollars(totals.categories[category].spent));setText('demo-'+prefix+'-available',dollars(totals.categories[category].available));}
 const chapter=chapters[step];setText('demo-chapter',chapter.label);setText('demo-title',chapter.title);setText('demo-description',chapter.description);
 const action=document.getElementById('demo-action');if(action){action.replaceChildren(document.createTextNode(chapter.action+' '));const arrow=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [name,value] of Object.entries({viewBox:'0 0 24 24',width:'1em',height:'1em',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false',class:'inline-icon'}))arrow.setAttribute(name,value);const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',step===4?'M3 7v5h5M20 17a8 8 0 0 1-14-2M3 7A8 8 0 0 1 17 5l4 3':'M7 17 17 7M7 7h10v10');arrow.append(path);action.append(arrow);}
 document.querySelectorAll<HTMLElement>('[data-step]').forEach(label=>label.classList.toggle('active',Number(label.dataset.step)<=step));
}
document.getElementById('demo-action')?.addEventListener('click',()=>{
 if(step===4){budget=sampleBudget();step=0;render();return;}
 const actionDate=monthEnd(month);
 if(step===0)budget=allocate(budget,'ready','groceries',20000,actionDate);
 if(step===1)budget=allocate(budget,'groceries','annual',10000,actionDate);
 if(step===2){budget=allocate(budget,'groceries','home',7500,actionDate);budget=validateBudget({...budget,entries:[...budget.entries,{id:'surprise-bill',kind:'expense',amount:7500,date:actionDate,accountId:'cash',categoryId:'home',payee:'Extra household bill',note:'',cleared:true}]});}
 if(step===3)budget=allocate(budget,'groceries','buffer',10000,actionDate);
 step++;render();
});
document.getElementById('reset-demo')?.addEventListener('click',()=>{budget=sampleBudget();step=0;render();});
const privacy=document.getElementById('privacy-dialog') as HTMLDialogElement|null;
document.getElementById('privacy-open')?.addEventListener('click',()=>window.Cookiebot?window.Cookiebot.renew():privacy?.showModal());
document.getElementById('privacy-close')?.addEventListener('click',()=>privacy?.close());
privacy?.addEventListener('click',event=>{if(event.target!==privacy)return;const rect=privacy.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)privacy.close();});
if(import.meta.env.DEV)document.querySelector('meta[name="robots"]')?.setAttribute('content','noindex,follow');
