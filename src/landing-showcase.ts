import {allocate,calculate,validateBudget,money} from './engine';
import type {Budget} from './engine';
import {sharedDinnerExample} from './public-example';

// These examples are memory-only. No account, storage or API is accessed.
const root=document.getElementById('product-preview');
if(root){
 const date='2026-09-01',month='2026-09';
 const text=(id:string,value:string)=>{document.getElementById(id)!.textContent=value;};
 const tabs=Array.from(root.querySelectorAll<HTMLButtonElement>('[role=tab]'));
 function selectTab(tab:HTMLButtonElement,focus=false){
  for(const candidate of tabs){
   const selected=candidate===tab;
   candidate.setAttribute('aria-selected',String(selected));
   candidate.tabIndex=selected?0:-1;
   document.getElementById(candidate.getAttribute('aria-controls')!)!.hidden=!selected;
  }
  if(focus)tab.focus();
 }
 for(const tab of tabs){
  tab.addEventListener('click',()=>selectTab(tab));
  tab.addEventListener('keydown',event=>{
   const index=tabs.indexOf(tab);
   const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;
   if(next!==null){event.preventDefault();selectTab(tabs[next],true);}
  });
 }
 const plan=():Budget=>{
  let budget=validateBudget({
   version:2,name:'Fictional landing plan',currency:'USD',demo:true,
   accounts:[{id:'cash',name:'Example bank',type:'checking',opening:320000,date},{id:'card',name:'Example card',type:'credit',opening:-25000,date}],
   categories:[
    {id:'home',name:'Home & bills',group:'My plan',icon:'home',color:'sage',target:185000,targetType:'monthly'},
    {id:'groceries',name:'Groceries',group:'My plan',icon:'basket',color:'blue',target:40000,targetType:'monthly'},
    {id:'dining',name:'Dining',group:'My plan',icon:'food',color:'peach',target:15000,targetType:'monthly'},
    {id:'insurance',name:'Annual insurance',group:'My plan',icon:'repeat',color:'lavender',target:120000,targetType:'balance'},
   ],entries:[],
  });
  for(const [category,amount] of [['home',185000],['groceries',40000],['dining',15000],['insurance',10000],['card:card',25000]] as const)
   budget=allocate(budget,'ready',category,amount,date);
  return budget;
 };
 let planned=false;
 const planButton=document.getElementById('preview-plan-action')!;
 planButton.addEventListener('click',()=>{
  planned=!planned;
  const budget=planned?allocate(plan(),'ready','insurance',10000,date):plan();
  const totals=calculate(budget,month);
  text('preview-ready',money(totals.ready));
  text('preview-insurance-plan',money(totals.categories.insurance.assigned));
  text('preview-insurance-left',money(totals.categories.insurance.available));
  text('preview-plan-status',planned?'$100 set aside. Your bank balance stays the same.':'Try planning for the annual bill.');
  planButton.firstChild!.textContent=planned?'Reset planning example ':'Set aside another $100 ';
 });
 let repaid=false;
 const repaymentButton=document.getElementById('preview-repay-action')!;
 repaymentButton.addEventListener('click',()=>{
  repaid=!repaid;
  const totals=sharedDinnerExample(repaid?8000:4000);
  text('preview-personal',money(totals.spent));
  text('preview-friends',money(totals.shared.receivable));
  text('preview-shared-cash',money(totals.cash));
  text('preview-sam-state',repaid?'Repaid':'Owes you');
  document.getElementById('preview-sam-state')!.classList.toggle('received',repaid);
  text('preview-repay-status',repaid?'Repaid. Your spending stays $40.00. No new income.':'See what changes when Sam pays you back.');
  repaymentButton.firstChild!.textContent=repaid?'Reset repayment example ':'Record Sam’s $40 repayment ';
 });
 root.querySelector<HTMLElement>('[role=tablist]')!.hidden=false;
 document.querySelector<HTMLElement>('#preview-budget .preview-action')!.hidden=false;
}
