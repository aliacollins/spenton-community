import {calculate, money, targetNeed, today} from './engine';
import type {Budget, Totals} from './engine';
export type InsightAction={kind:'category';id:string}|{kind:'plan'|'record'|'accounts'|'shortfall'};
export type Insight={id:string;tone:'attention'|'opportunity'|'neutral';title:string;detail:string;label:string;action:InsightAction};
export function reviewMoney(b:Budget,t:Totals,month:string):Insight[]{
 const fmt=(n:number)=>money(n,b.currency),items:Insight[]=[];
 if(t.ready<0)items.push({id:'shortfall',tone:'attention',title:t.cash<0?'You have spent more than you have.':`Your cash shortfall is ${fmt(-t.ready)}.`,detail:`${fmt(-t.ready)} needs covering. Review your recorded balances and move money from funded categories.`,label:'Cover the shortfall',action:{kind:'shortfall'}});
 for(const c of [...b.categories].sort((a,z)=>t.categories[a.id].available-t.categories[z.id].available))if(t.categories[c.id].available<0)items.push({id:'over-'+c.id,tone:'attention',title:`${c.name} is overspent by ${fmt(-t.categories[c.id].available)}.`,detail:'Spending has used more than this category had available. Move money from another category or review its purchases.',label:'Review category',action:{kind:'category',id:c.id}});
 for(const a of b.accounts.filter(a=>a.type==='credit')){const card=t.cards[a.id];if(card.unbacked>0)items.push({id:'card-'+a.id,tone:'attention',title:`${a.name} needs ${fmt(card.unbacked)} set aside for repayment.`,detail:`This covers all card debt without cash set aside, not just your statement.${card.statementGap>0?` Your statement needs ${fmt(card.statementGap)} of this amount.`:''}`,label:'Review cards',action:{kind:'accounts'}});}
 const needs=b.categories.map(c=>({c,need:targetNeed(c,t.categories[c.id],month)})).filter(x=>x.need>0).sort((a,z)=>z.need-a.need),gap=needs.reduce((n,x)=>n+x.need,0);
 if(t.ready>0)items.push({id:'ready',tone:'opportunity',title:`You have ${fmt(t.ready)} available to plan.`,detail:gap>0?`Your goals need ${fmt(gap)} more this month. ${t.ready>=gap?'Available to plan can cover this.':`After using this cash, ${fmt(gap-t.ready)} would still be needed.`} Check upcoming bills first.`:'Set it aside for bills, spending or savings. This amount includes any unplanned opening balances and money from earlier months.',label:'Plan this money',action:{kind:'plan'}});
 if(needs.length){const {c,need}=needs[0];items.push({id:'goal-'+c.id,tone:'opportunity',title:`${c.name} needs ${fmt(need)} to meet this month’s goal.`,detail:`${needs.length>1?`${needs.length} goals need ${fmt(gap)} in total. `:''}Goal amounts are suggestions, not bills.`,label:'Review goal',action:{kind:'category',id:c.id}});}
 if(!t.transactions.some(e=>(e.kind==='expense'||e.kind==='shared_charge')))items.push({id:'record',tone:'neutral',title:'No purchases recorded this month',detail:'If you have made purchases, record them to see your spending here.',label:'Record a purchase',action:{kind:'record'}});
 if(!items.length)items.push({id:'steady',tone:'neutral',title:'Your recorded spending and goals are covered.',detail:'Check that your transactions and account balances are up to date.',label:'Review accounts',action:{kind:'accounts'}});
 return items;
}
export function spendingComparison(b:Budget,month:string,date=today()){
 const [year,m]=month.split('-').map(Number),previous=`${m===1?year-1:year}-${String(m===1?12:m-1).padStart(2,'0')}`;
 const currentMonth=date.slice(0,7),partial=month===currentMonth;
 const day=partial?Math.min(Number(date.slice(8)),new Date(year,m-1,0).getDate()):31;
 const through=(period:string)=>period+'-'+String(day).padStart(2,'0');
 const throughBudget=(period:string)=>({...b,entries:b.entries.filter(e=>e.date<=through(period))});
 const now=calculate(throughBudget(month),month),before=calculate(throughBudget(previous),previous);
 const available=month<=currentMonth&&now.transactions.some(e=>(e.kind==='expense'||e.kind==='shared_charge'))&&before.transactions.some(e=>(e.kind==='expense'||e.kind==='shared_charge'));
 const changes=b.categories.map(c=>({category:c,current:now.categories[c.id].spent,previous:before.categories[c.id].spent,delta:now.categories[c.id].spent-before.categories[c.id].spent})).filter(x=>x.delta!==0).sort((a,z)=>Math.abs(z.delta)-Math.abs(a.delta));
 return {available,previous,partial,day,current:now.spent,before:before.spent,delta:now.spent-before.spent,changes,period:partial?`${month}-01 to ${through(month)} vs ${previous}-01 to ${through(previous)}`:`${month} vs ${previous} · full recorded months`};
}
