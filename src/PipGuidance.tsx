import {createContext,useContext,useEffect,useState} from 'react';
import type {ReactNode,RefObject} from 'react';
import {ChevronDown} from 'lucide-react';
import type {OnboardingController,LearningStep} from './onboarding-client';
import './pip-guidance.css';

const Guidance=createContext<OnboardingController|null>(null);
export function PipGuideProvider({controller,children}:{controller:OnboardingController;children:ReactNode}){return <Guidance.Provider value={controller}>{children}</Guidance.Provider>;}

const topics={
 starting:{title:'Start with money you have today.',body:'Add an account balance, then plan how to use it. No bank connection needed.',example:'An account shows where your money is. Categories show what it is for.'},
 nickname:{title:'Use a name you know.',body:'You could use “Salary account” or “Cash wallet”. Do not enter an account number or bank password.',example:'This name helps you tell your accounts apart.'},
 currency:{title:'Pick the currency you use for this budget.',body:'Every amount in this budget uses this currency. SpentOn does not change one currency into another.',example:'Use a separate budget for money you plan in a different currency.'},
 balance:{title:'What’s in this account right now?',body:'Enter its current balance before any transactions you plan to add. Don’t include a paycheck that hasn’t arrived.',example:'If your bank shows 1,000 today and you expect 500 next week, start with 1,000.'},
 accountType:{title:'Choose the account type.',body:'Checking, savings and cash wallets hold money you have. A credit card records money you owe.',example:'Investment accounts track value outside your spending budget.'},
 categories:{title:'Choose your spending and savings categories.',body:'Pick the categories you need. You can change them later.',example:'Groceries, rent, and a rainy-day fund can all live in the same bank account.'},
 plan:{title:'Set money aside. It stays in your bank.',body:'Add money to a category. Available to plan decreases by that amount.',example:'Zero-based budgeting means planning your budget cash, including savings. It does not mean spending it all.'},
 purchase:{title:'Record a transaction.',body:'Choose the transaction type, amount and account. Purchases also need a category.',example:'Buying something counts as spending. Moving money between your accounts or paying a card bill does not count as another purchase.'},
 amount:{title:'Enter the transaction amount.',body:'Enter the amount paid, received or transferred. Purchases can be split across categories.',example:'Enter 200 for a transaction of 200. SpentOn calculates the new balances.'},
 transactionAccount:{title:'Which account did you use?',body:'Choose the account affected by this transaction. Saving updates its recorded balance.',example:'An account tracks a balance. A category tracks what the money is for.'},
 payee:{title:'Who did you pay, or who paid you?',body:'Enter a shop, person or employer so you can recognise the transaction later.',example:'“Corner shop” is enough. You don’t need to include a reference number.'},
 category:{title:'What did you spend it on?',body:'Choose a category. Saving the purchase reduces the money left in it.',example:'Use Groceries for food shopping even if you paid with the same card you use for everything else.'},
 date:{title:'When did it happen?',body:'Enter the transaction date. Future entries only affect your budget when you record them.',example:'A September purchase counts in September, even if you pay its card bill in October.'},
 cleared:{title:'Has your bank confirmed it yet?',body:'Mark completed bank transactions as cleared. Pending transactions still affect your budget.',example:'You can mark it cleared later when the bank shows it as complete.'},
 note:{title:'Add a note if needed.',body:'Add a reminder, or leave this blank.',example:'Avoid passwords, account credentials, or other sensitive details in notes.'},
 card:{title:'Tell me what you owe, not your credit limit.',body:'Enter what you already owe on the card. Setting money aside for it does not pay the bill. It keeps that money ready for when you pay.',example:'If your card limit is 5,000 but you owe 600, enter 600.'},
 payment:{title:'Paying the card bill is not new spending.',body:'Choose the cash account the payment leaves and the card it pays. The original purchases already counted as spending.',example:'A 100 card purchase and a later 100 bill payment count as 100 spent, not 200.'},
 transfer:{title:'Move money between your accounts.',body:'Choose the source and destination accounts. Total spending stays the same.',example:'Moving 200 from checking to savings changes their balances. Your category amounts stay the same.'},
 income:{title:'Record money you received.',body:'Received income adds to Available to plan. Scheduled income is excluded until you record it.',example:'Add payday when the money arrives, then decide what it needs to cover before the next payday.'},
 goal:{title:'A goal helps you save.',body:'Enter how much you want to save and when. The preview shows a suggested amount to save each month. Saving the goal does not move money.',example:'A goal helps you plan. You still choose and save the amount to assign to its category.'},
 goalAmount:{title:'How much do you want to save?',body:'For a savings goal, enter the total you want. For Every month, enter how much you want to add each month.',example:'Money already in this category counts toward your savings goal.'},
 goalDate:{title:'Choose a date, or leave it open.',body:'A timeline spreads the remaining savings across the months ahead. This month counts, and money already assigned is included.',example:'A 1,200 goal over 12 months starts at 100 per month if you have nothing saved yet.'},
 cap:{title:'This is your saving limit.',body:'Choose how much you want in this category. Once it reaches that amount, you can stop adding money. If you use some, you can add more.',example:'Add 100 per month until the category has 500. It can refill after you use it.'},
 reconcile:{title:'Does SpentOn match your bank?',body:'First, check the payments your bank has confirmed. Add anything missing and fix mistakes. Only change the balance directly when you know why it is different.',example:'If you adjust the balance, add a reason so you can understand the change later.'},
 statement:{title:'Your card bill and total debt can be different.',body:'Enter the bill amount and due date shown by your bank. Purchases made after the bill was issued can make your total debt higher.',example:'A 400 statement can be part of 600 in total card debt. Both numbers can be right.'},
 refund:{title:'Link this to the original purchase.',body:'A refund reduces recorded spending and returns money to the original category. It is not new income.',example:'Refunding part of a purchase restores that part of its category money.'},
 import:{title:'Check transactions before importing.',body:'Check the dates, amounts and account, then look for duplicates. Only confirm when the preview matches the file you intended.',example:'Importing is an alternative to typing the same purchases. Don’t record them twice.'},
};
type Topic=keyof typeof topics;
function contextFor(title:string):{topic:Topic;step:LearningStep}|null{
 const value=title.toLowerCase();
 if(value.includes('budget')&&(value.includes('create')||value.includes('replace')||value.includes('backup')))return {topic:'starting',step:'budget'};
 if(value.includes('account')&&value.includes('add'))return {topic:'balance',step:'budget'};
 if(value.includes('plan your money')||value.includes('move category money'))return {topic:'plan',step:'plan'};
 if(value.includes('goal'))return {topic:'goal',step:'plan'};
 if(value.includes('category')||value.includes('categories'))return {topic:'categories',step:'plan'};
 if(value.includes('statement'))return {topic:'statement',step:'purchase'};
 if(value.includes('reconcil'))return {topic:'reconcile',step:'purchase'};
 if(value.includes('refund'))return {topic:'refund',step:'purchase'};
 if(value.includes('import'))return {topic:'import',step:'purchase'};
 if(value.includes('transaction')||value.includes('purchase'))return {topic:'purchase',step:'purchase'};
 return null;
}
/** Only known control identifiers choose explanations. Field values are never inspected or sent. */
function topicFor(element:Element,base:Topic):Topic{
 if(element.closest('.plan-money-row'))return 'plan';
 const key=(element.getAttribute('name')??element.getAttribute('aria-label')??'').toLowerCase();
 if(key.includes('goal balance limit')||key==='targetcap')return 'cap';
 if(key==='target'||key==='goal amount')return 'goalAmount';
 if(key.includes('months to save')||key.includes('goal date')||key==='targetdate')return 'goalDate';
 if(key==='currency'||key==='budget currency')return 'currency';
 if(key==='accounttype'||key==='account type')return 'accountType';
 if(key==='opening'||key==='current cash balance'||key==='opening balance')return 'balance';
 if(key==='amount owed')return 'card';
 if(key==='transaction amount'||key==='amount')return 'amount';
 if(key==='transaction account'||key==='accountid')return 'transactionAccount';
 if(key==='account')return 'nickname';
 if(key==='name')return base==='balance'?'nickname':base;
 if(key==='payee'||key.includes('payee'))return 'payee';
 if(key==='categoryid'||key==='transaction category'||element.closest('.category-picker'))return 'category';
 if(key==='starter')return 'categories';
 if(key==='date')return 'date';
 if(key==='cleared')return 'cleared';
 if(key==='note')return 'note';
 return base;
}
export function PipFieldGuide({dialogRef,title,message}:{dialogRef:RefObject<HTMLDialogElement|null>;title:string;message?:string}){
 const controller=useContext(Guidance),context=contextFor(title),[topic,setTopic]=useState<Topic|null>(null),[more,setMore]=useState(false);
 const active=controller?.state?.status==='active';
 useEffect(()=>{
  setTopic(null);setMore(false);if(!active||!context)return;
  const dialog=dialogRef.current;if(!dialog)return;
  controller?.event(context.step,'viewed');
  const focus=(event:Event)=>{const target=event.target;if(target instanceof Element&&target.matches('input,select,textarea,button[role=combobox]')){setTopic(topicFor(target,context.topic));setMore(false);}};
  const invalid=()=>controller?.event(context.step,'blocked','input');
  const submit=()=>{controller?.event(context.step,'action');queueMicrotask(()=>{if(dialog.querySelector('.form-error'))invalid();});};
  dialog.addEventListener('focusin',focus);dialog.addEventListener('invalid',invalid,true);dialog.addEventListener('submit',submit);
  return()=>{dialog.removeEventListener('focusin',focus);dialog.removeEventListener('invalid',invalid,true);dialog.removeEventListener('submit',submit);};
 },[active,title]);
 if(!active||!context)return null;
 const selected=topics[topic??context.topic];
 return <aside className="pip-field-guide" aria-label="Pip explains this form"><img src="/brand/pip-small.png" alt="" width="46" height="46"/><div><span>PIP IS HERE TO HELP</span><strong>{selected.title}</strong>{(controller?.state?.experience!=='familiar'||more||message)&&<p>{message&&(!topic||topic==='plan'||topic==='amount')?message:selected.body}</p>}<button type="button" className="text-button" aria-expanded={more} onClick={()=>setMore(!more)}>{more?'Show less':'Tell me more'}<ChevronDown size={12}/></button>{more&&<p className="pip-field-example">{selected.example}</p>}</div></aside>;
}
