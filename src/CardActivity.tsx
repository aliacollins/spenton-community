import type { Account, Budget } from './engine';
import { money } from './engine';
import { cardActivity } from './card-activity';

export default function CardActivity({budget,account,month}:{budget:Budget;account:Account;month:string}){
 const rows=cardActivity(budget,account.id,month),current=rows[2],fmt=(n:number)=>money(n,budget.currency);
 const label=(value:string)=>new Date(value+'-01T12:00:00').toLocaleDateString('en-US',{month:'short',year:'numeric'});
 return <section className="card-activity" aria-label={'Spending and payments for '+account.name}><h4>Spending and payments</h4><div className="card-activity-summary"><div><span>Spent in {label(month)}</span><strong>{fmt(current.spending)}</strong><small>Purchases less refunds</small></div><div><span>Paid in {label(month)}</span><strong>{fmt(current.payments)}</strong><small>Cash sent to this card</small></div></div><details><summary>Compare months</summary><table aria-label={'Monthly card activity for '+account.name}><thead><tr><th>Month</th><th>Spent</th><th>Paid</th></tr></thead><tbody>{rows.map(row=><tr key={row.month}><th>{label(row.month)}</th><td>{fmt(row.spending)}</td><td>{fmt(row.payments)}</td></tr>)}</tbody></table><p>A payment can settle purchases from earlier months. These columns do not need to match. Opening debt and balance adjustments are excluded from spending.</p></details></section>;
}
