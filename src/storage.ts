import type { Budget } from './engine';
export function download(text:string,name:string,type='application/json'){
 const url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export const exportBudget=(budget:Budget)=>download(JSON.stringify(budget,null,2),'spenton-budget-'+new Date().toISOString().slice(0,10)+'.json');
