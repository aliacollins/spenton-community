import {lazy,Suspense} from 'react';
import type {ComponentType} from 'react';
import type {CloudBudget,CloudUser} from './cloud';
import {Modal} from './ui';
import LoadingState from './LoadingState';

export type Offer = {amountMinor:number;currency:'USD';recurring:boolean;available:boolean;baseAmountMinor?:number;discount?:{label:string;duration:string;discountCycles?:number;baseAmountMinor?:number}|null};
export type BillingStatus = {state:'trial'|'paid'|'coupon'|'expired'|'self-hosted';canEdit:boolean;disputeHold?:boolean;trialDays:number;trialEndsAt:string|null;accessEndsAt:string|null;daysRemaining:number;offers:Record<'monthly'|'annual',Offer>;checkout:{id:string;offer:'monthly'|'annual';state:string;providerStatus:string;cancelScheduled:boolean;discountTerms?:string|null}|null};
export const accessLabel=(status:BillingStatus)=>status.state==='self-hosted'?'Connected to your server':status.disputeHold?'A payment dispute is being reviewed':status.state==='trial'?`${status.daysRemaining} ${status.daysRemaining===1?'day':'days'} left in your free trial`:status.state==='expired'?'Your budget is in view-only mode':status.state==='coupon'?'Access from your coupon':'Your paid access is active';
type AccessProps={status:BillingStatus;user:CloudUser;onUpdate:(status:BillingStatus)=>void;onClose:()=>void};
type AdminProps={onClose:()=>void;onReplay:()=>void;onTestBudget:(budget:CloudBudget)=>void};
const billingModules=import.meta.glob<{BillingDialog:ComponentType<AccessProps>}>('./BillingPanel.tsx');
const adminModules=import.meta.glob<{AdminPanel:ComponentType<AdminProps>}>('./AdminPanel.tsx');
const Unavailable=()=> <p role="alert">These Cloud tools are not included in this installation.</p>;
const CloudBilling=lazy<ComponentType<AccessProps>>(async()=>({default:billingModules['./BillingPanel.tsx']?(await billingModules['./BillingPanel.tsx']()).BillingDialog:Unavailable}));
export const AdminPanel=lazy<ComponentType<AdminProps>>(async()=>({default:adminModules['./AdminPanel.tsx']?(await adminModules['./AdminPanel.tsx']()).AdminPanel:Unavailable}));

export function BillingDialog(props:AccessProps){
 if(props.status.state==='self-hosted')return <Modal title="Your SpentOn server" onClose={props.onClose}><div className="form-body"><h2>Connected to your server</h2><p>Your budgets are saved on {location.host}. No SpentOn Cloud subscription is required.</p><p>Your server operator manages updates, backups and provider settings.</p></div></Modal>;
 return <Suspense fallback={<LoadingState layout="panel" label="Opening your plan"/>}><CloudBilling {...props}/></Suspense>;
}
