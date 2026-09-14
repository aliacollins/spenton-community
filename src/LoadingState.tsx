import {useEffect,useState} from 'react';
import './loading-state.css';

type Props={label:string;detail?:string;layout?:'page'|'list'|'panel'|'inline';className?:string};

export function LoadingIndicator({label}:{label:string}){
 return <span className="spenton-loading-inline" role="status"><span className="spenton-loading-spinner" aria-hidden="true"/><span>{label}</span></span>;
}

export default function LoadingState({label,detail,layout='panel',className=''}:Props){
 const [slow,setSlow]=useState(false);
 useEffect(()=>{setSlow(false);const timer=setTimeout(()=>setSlow(true),8000);return()=>clearTimeout(timer);},[label]);
 if(layout==='inline')return <LoadingIndicator label={label}/>;
 const Title=layout==='page'?'h1':'p';
 return <section className={'spenton-loader '+className} data-layout={layout} role="status" aria-live="polite" aria-atomic="true">
  <div className="spenton-loader-heading">
   <div className="spenton-loader-mark" aria-hidden="true"><span className="spenton-loader-orbit"/><img src="/brand/pip-welcome-small.png" alt="" width="80" height="80"/></div>
   <div className="spenton-loader-copy"><Title className="spenton-loader-title">{label}</Title>{detail&&<p className="spenton-loader-detail">{detail}</p>}<div className="spenton-loader-track" aria-hidden="true"><span/></div></div>
  </div>
  <div className="spenton-loader-skeleton" aria-hidden="true">
   <div className="spenton-loader-lines">{Array.from({length:layout==='panel'?3:4},(_,i)=><div className="spenton-loader-row" key={i}><i className="spenton-loader-shape skeleton-icon"/><div><i className="spenton-loader-shape skeleton-title"/><i className="spenton-loader-shape skeleton-detail"/></div><i className="spenton-loader-shape skeleton-value"/></div>)}</div>
   {layout==='page'&&<div className="spenton-loader-side"><i className="spenton-loader-shape skeleton-title"/><i className="spenton-loader-shape skeleton-large"/><i className="spenton-loader-shape skeleton-detail"/><i className="spenton-loader-shape skeleton-detail"/></div>}
  </div>
  {slow&&<p className="spenton-loader-slow">Still waiting for a response. This is taking longer than usual.</p>}
 </section>;
}
