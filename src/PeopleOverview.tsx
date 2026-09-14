import {ArrowDownLeft,ArrowLeft,ArrowUpRight,Check,ChevronDown,ChevronRight,Clock3,Receipt,Search,Users,X} from 'lucide-react';
import {money} from './engine';
import {useEffect,useRef} from 'react';
import type {ReactNode} from 'react';
import Select from './Select';
import {acceptanceLabel,currencyName,peopleCurrencyTotals,personBalanceHint} from './people-presentation';

export type PersonBalance={email:string;name?:string;personKey?:string;currency:string;owedToYou:number;youOwe:number;pendingToYou:number;pendingFromYou:number;requestedToYou:number;requestedFromYou:number};
export type PeopleFilter='all'|'incoming'|'outgoing'|'settled';
export const personName=(person:PersonBalance)=>person.name||person.email.split('@')[0]||'Contact';
export const personKey=(person:PersonBalance)=>person.personKey??person.email;
export const isSettled=(person:PersonBalance)=>person.owedToYou+person.youOwe+person.requestedToYou+person.requestedFromYou+person.pendingToYou+person.pendingFromYou===0;

export function PersonAvatar({name,identity=name,status}:{name:string;identity?:string;status?:'settled'|'waiting'|'open'}){
 const tone=Array.from(identity).reduce((n,c)=>n+c.codePointAt(0)!,0)%3;
 return <span className={`person-avatar tone-${tone}`} aria-hidden="true">{Array.from(name.trim())[0]?.toUpperCase()||'?'}{status&&<span className={'person-avatar-status '+status}>{status==='settled'?<Check/>:status==='waiting'?<Clock3/>:<ArrowUpRight/>}</span>}</span>;
}

export type PeopleView='people'|'bills';

function PersonAmounts({person,showClosed=false}:{person:PersonBalance;showClosed?:boolean}){
 const amount=(label:string,value:number)=><span className="person-amount-line"><span>{label}</span><strong>{money(value,person.currency)} <small>{person.currency}</small></strong></span>;
 return <span className="person-amounts">
  {person.owedToYou>0&&amount('Owes you',person.owedToYou)}
  {person.youOwe>0&&amount('You owe',person.youOwe)}
  {person.requestedToYou>0&&person.owedToYou===0&&amount('Requested by you',person.requestedToYou)}
  {person.requestedFromYou>0&&amount('Requested from you',person.requestedFromYou)}
  {showClosed&&isSettled(person)&&<span className="person-settled">No outstanding balance · {person.currency}</span>}
 </span>;
}

export default function PeopleOverview({balances,filter,onFilter,search,onSearch,selected,onSelect,onClear,currencyFilter,onCurrency,scope,hasBills,view,onView,forceHistory=false,review,children}:{
 balances:PersonBalance[];filter:PeopleFilter;onFilter:(filter:PeopleFilter,currency?:string)=>void;search:string;onSearch:(search:string)=>void;selected:string;onSelect:(key:string)=>void;onClear:()=>void;
 currencyFilter:string;onCurrency:(currency:string)=>void;scope:string;hasBills:boolean;view:PeopleView;onView:(view:PeopleView)=>void;forceHistory?:boolean;review:ReactNode;children:ReactNode;
}){
 const detail=useRef<HTMLElement>(null),directory=useRef<HTMLElement>(null),previous=useRef(selected),previousView=useRef(view),returnFocus=useRef(false);
 useEffect(()=>{
  const old=previous.current;previous.current=selected;
  if(selected){detail.current?.querySelector<HTMLElement>('h2')?.focus({preventScroll:true});detail.current?.scrollIntoView({block:'start'});}
  else if(old&&returnFocus.current){const button=Array.from(directory.current?.querySelectorAll<HTMLButtonElement>('[data-person]')??[]).find(button=>button.dataset.person===old);(button??document.getElementById('people-directory-title'))?.focus({preventScroll:true});button?.scrollIntoView({block:'nearest'});}
  returnFocus.current=false;
 },[selected]);
 useEffect(()=>{
  if(previousView.current===view)return;previousView.current=view;
  const target=document.getElementById(view==='bills'?'people-history-title':'people-all-bills');
  target?.focus({preventScroll:true});target?.scrollIntoView({block:'nearest'});
 },[view]);
 const groups=new Map<string,PersonBalance[]>();
 for(const person of balances){const key=personKey(person);groups.set(key,[...(groups.get(key)??[]),person]);}
 const currencies=[...new Set(balances.map(person=>person.currency))].sort(),totals=peopleCurrencyTotals(balances).filter(row=>!currencyFilter||row.currency===currencyFilter);
 const matches=(person:PersonBalance,people:PersonBalance[])=> (!currencyFilter||person.currency===currencyFilter)&&(filter==='all'||filter==='settled'&&people.filter(row=>!currencyFilter||row.currency===currencyFilter).every(isSettled)||filter==='incoming'&&person.owedToYou+person.requestedToYou>0||filter==='outgoing'&&person.youOwe+person.requestedFromYou>0);
 const shown=[...groups].filter(([,people])=>people.some(person=>(personName(person)+' '+person.email).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))&&people.some(person=>matches(person,people)));
 const selectedIdentity=balances.find(person=>personKey(person)===selected),selectedPeople=balances.filter(person=>personKey(person)===selected&&(!currencyFilter||person.currency===currencyFilter));
 const historyVisible=!!selected||view==='bills'||forceHistory||(!balances.length&&hasBills),empty=!balances.length&&!hasBills;
 const back=()=>{returnFocus.current=true;onClear();onView('people');};
 return <>
  {!historyVisible&&!empty&&<>
   <section className="people-summary" aria-label="Balances across shared expenses">
    <p className="people-balance-scope">{scope} · All dates</p>
    <div className="people-money-columns">{(['incoming','outgoing'] as const).map(direction=>{
     const values=totals.filter(row=>row[direction]>0);
     return <div className="people-money-section" key={direction}><h2>{direction==='incoming'?<ArrowDownLeft size={17} aria-hidden="true"/>:<ArrowUpRight size={17} aria-hidden="true"/>}{direction==='incoming'?'Owed to you':'You owe'}</h2>
      <div className="people-money-values">{values.length?values.map(row=><button className="people-balance-link" type="button" key={row.currency} aria-label={'Show '+row.currency+(direction==='incoming'?' owed to you':' you owe')} aria-description={money(row[direction],row.currency)+' '+row.currency} onClick={()=>{onSearch('');onFilter(direction,row.currency);}}>{money(row[direction],row.currency)} <small>{row.currency}</small><ChevronRight size={14} aria-hidden="true"/></button>):<p className="people-zero">Nothing owed</p>}</div>
      {direction==='outgoing'&&totals.filter(row=>row.requested>0).map(row=><button key={row.currency} type="button" className="people-request-note" onClick={()=>{onSearch('');onFilter('outgoing',row.currency);}}>{money(row.requested,row.currency)} {row.currency} requested from you. Review before accepting.<ChevronRight size={13}/></button>)}
     </div>;
    })}</div>
   </section>
   {!search.trim()&&review}
  </>}
  {selected&&<section className="people-detail" ref={detail} aria-label="Selected person">
   <button type="button" className="text-button" onClick={back}><ArrowLeft size={16} aria-hidden="true"/>{forceHistory?'All group bills':'Back to People'}</button>
   <div className="people-person-summary"><div className="people-detail-identity"><PersonAvatar name={selectedIdentity?personName(selectedIdentity):'Contact'} identity={selected}/><div><h2 tabIndex={-1}>{selectedIdentity?personName(selectedIdentity):'Contact'}</h2>{selectedIdentity?.email&&<p>{selectedIdentity.email}</p>}</div></div>
    <div className="people-detail-totals">{selectedPeople.map(person=><PersonAmounts key={person.currency} person={person} showClosed/>)}</div>
   </div>
   {personBalanceHint(selectedPeople)&&<p className="people-person-hint">{personBalanceHint(selectedPeople)}. Check the relevant bill below.</p>}
  </section>}
  {!selected&&historyVisible&&!forceHistory&&<div className="people-history-intro">{(balances.length>0||!hasBills)&&<button type="button" className="text-button" onClick={()=>onView('people')}><ArrowLeft size={16}/>Back to People</button>}<h2 id="people-history-title" tabIndex={-1}>All shared bills</h2><p>{scope} · All dates</p></div>}
  {!empty&&<>
   {!historyVisible&&<div className="people-section-heading"><h2 id="people-directory-title" tabIndex={-1}>Your people <span>{shown.length===groups.size?groups.size:shown.length+' of '+groups.size}</span></h2><button id="people-all-bills" className="text-button" type="button" onClick={()=>onView('bills')}><Receipt size={16}/>All shared bills<ChevronRight size={14}/></button></div>}
   <div className="people-scope-controls">
    <div className="people-filters" role="group" aria-label={historyVisible?'Filter shared bills':'Filter people'}>{([['all',historyVisible?'All bills':'Everyone'],['incoming',historyVisible?'Owed to you':'Owes you'],['outgoing','You owe'],['settled',historyVisible?'Closed':'Settled']] as const).map(([value,label])=><button type="button" key={value} aria-pressed={filter===value} onClick={()=>onFilter(value)}>{label}</button>)}</div>
    <div className="people-filter-tools">{!historyVisible&&<label className="people-search-wrap"><Search aria-hidden="true"/><input className="people-search" type="search" aria-label="Find a person" placeholder="Search people" value={search} onChange={event=>onSearch(event.target.value)}/></label>}
     {currencies.length>1&&<Select aria-label="Shared currency" value={currencyFilter} onChange={event=>onCurrency(event.target.value)}><option value="">All currencies</option>{currencies.map(code=><option key={code} value={code}>{code} · {currencyName(code)}</option>)}</Select>}
    </div>
   </div>
  </>}
  {!historyVisible&&<section className="people-directory" aria-labelledby="people-directory-title" ref={directory}>
   <div className="people-rows">{shown.map(([key,people])=>{
    const person=people[0],visible=people.filter(row=>!currencyFilter||row.currency===currencyFilter),settled=visible.every(isSettled),hint=personBalanceHint(visible);
    return <button className="people-person-card" type="button" data-person={key} key={key} onClick={()=>onSelect(key)}>
     <PersonAvatar name={personName(person)} identity={key} status={settled?'settled':undefined}/><span className="people-person-name"><strong>{personName(person)}</strong><small className={visible.some(row=>row.pendingToYou||row.requestedFromYou)?'person-review-hint':''}>{settled?'No outstanding balance':hint||'View shared bills'}</small></span>
     {!settled&&<span className="people-row-amounts">{visible.map(row=><PersonAmounts key={row.currency} person={row}/>)}</span>}
     <ChevronRight className="person-chevron" aria-hidden="true"/>
    </button>;
   })}</div>
   {!shown.length&&<div className="people-empty">{empty?<img src="/brand/pip-welcome-small.png" alt="" width="88" height="88"/>:<Users aria-hidden="true"/>}<h2 id={empty?'people-directory-title':undefined}>{search?'No matching people':empty?'Your shared expenses start here':'No people in this view'}</h2><p>{search?'Try another name or email address.':empty?'Split a purchase you’ve recorded. Each person’s balance will appear here.':'Clear the filters to see your other contacts.'}</p>{(search||filter!=='all'||currencyFilter)&&<button className="button secondary" type="button" onClick={()=>{onSearch('');onFilter('all','');}}>Show everyone</button>}</div>}
  </section>}
  {historyVisible&&<section className="people-history" aria-label="Shared history">{children}</section>}
  {!empty&&<details className="people-total-help"><summary>How balances work<ChevronDown size={13} aria-hidden="true"/></summary><p>Money owed to you can include shares the other person has not accepted. Requests to you are separate until you accept them. A repayment clears from People after the receiver confirms the money arrived.</p></details>}
 </>;
}

export function RepaymentProgress({amount,confirmed,pending,currency,offset=0,refunded=0,cancelled=false,owned=true}:{amount:number;confirmed:number;pending:number;currency:string;offset?:number;refunded?:number;cancelled?:boolean;owned?:boolean}){
 if(cancelled||confirmed+pending+offset===0&&refunded===0)return null;
 const remaining=Math.max(0,amount-confirmed-pending-offset);
 const facts:[[number,string],...[number,string][]]=[[confirmed,owned?'Received':'Repayment confirmed'],...(offset?[[offset,'Offset (no money moved)'] as [number,string]]:[]),[pending,'Awaiting confirmation'],[remaining,'Not recorded as paid']];
 const visible=facts.filter(([value])=>value>0);
 if(visible.length===1&&pending>0&&confirmed+offset===0&&!refunded)return null;
 return <div className={'repayment-breakdown '+(offset?'has-offset':'')}>
  {confirmed+pending+offset>0&&(visible.length>1||confirmed>0||offset>0)&&<dl>{visible.map(([value,label])=><div key={label}><dt>{label}</dt><dd>{money(value,currency)}</dd></div>)}</dl>}
  {refunded>0&&<p className="group-note">{money(refunded,currency)} refunded from this share. Any money to return is tracked separately.</p>}
 </div>;
}

export function ShareStatus({state,owned=true}:{state:string;owned?:boolean;amount?:number;confirmed?:number;pending?:number;offset?:number}){
 const text=acceptanceLabel(state,owned),Icon=state==='accepted'?Check:state==='cancelled'||state==='declined'?X:Clock3;
 return <span className={'people-status '+(state==='accepted'?'accepted':'')}><Icon aria-hidden="true"/>{text}</span>;
}
