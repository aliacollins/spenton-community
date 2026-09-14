import {ArrowRight} from 'lucide-react';
import {money} from './engine';
import type {Budget,SharedTotals} from './engine';
import pipArtwork from './brand/pip.svg';

export default function BudgetSharingNote({shared,currency,onReview}:{shared:SharedTotals;currency:Budget['currency'];onReview:()=>void}){
 const hasReceivable=shared.receivable>0,hasDebt=shared.owed>0;
 return <section className="budget-sharing-note" aria-label="Shared expenses in this budget">
  <img src={pipArtwork} width="64" height="64" alt=""/>
  <div className="budget-sharing-copy">
   <strong>{hasReceivable?`Friends owe you ${money(shared.receivable,currency)}.`:hasDebt?`You owe ${money(shared.owed,currency)}.`:'Shared expenses'}</strong>
   <p>{hasReceivable?'Money owed to you is not available to spend until it is received and recorded.':hasDebt?'Review each bill and record repayments in People.':'Review shared bills and repayments, or split a purchase.'}</p>
   {hasDebt&&<dl className="budget-sharing-facts">
    {hasReceivable&&<div><dt>You owe</dt><dd>{money(shared.owed,currency)}</dd></div>}
    <div><dt>Cash set aside for friends</dt><dd>{money(shared.reserved,currency)}</dd></div>
   </dl>}
  </div>
  <button type="button" className="text-button" onClick={onReview}>Review in People<ArrowRight size={18} aria-hidden="true"/></button>
 </section>;
}
