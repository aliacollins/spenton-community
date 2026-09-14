import { ArrowRight, ArrowLeftRight, RefreshCw, TrendingUp } from 'lucide-react';
import { money } from './engine';
import type { Account, Budget } from './engine';
import type { DialogState } from './Dialogs';
import './investment.css';

export default function InvestmentDetail({account,budget,balance,open,onActivity}:{account:Account;budget:Budget;balance:number;open:(dialog:DialogState)=>void;onActivity:()=>void}){
 const other=budget.accounts.find(a=>a.type!=='credit'&&a.id!==account.id);
 return <section className="account-tile investment" aria-label={'Investment account: '+account.name}>
  <div className="account-tile-top"><span className="account-symbol"><TrendingUp size={21}/></span><span className="account-type">INVESTMENT</span></div>
  <h3>{account.name}</h3><span className="account-digits">Manually tracked</span>
  <strong className="account-big-balance">{money(balance,budget.currency)}</strong><span className="small muted">Recorded investment value</span>
  <p className="investment-budget-note">Included in net worth. Excluded from Available to plan.</p>
  <button className="button secondary full" onClick={()=>open({type:'reconcile',accountId:account.id})}><RefreshCw size={15}/>Update balance</button>
  {other&&<button className="text-button" onClick={()=>open({type:'transaction',kind:'transfer',accountId:other.id,toAccountId:account.id})}><ArrowLeftRight size={14}/>Record transfer</button>}
  <button className="text-button" onClick={onActivity}>View activity<ArrowRight size={14}/></button>
 </section>;
}
