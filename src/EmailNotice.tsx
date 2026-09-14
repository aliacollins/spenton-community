import {useEffect,useRef} from 'react';
import {MailCheck} from 'lucide-react';

export default function EmailNotice({email,message}:{email:string;message:string}){
 const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{ref.current?.focus({preventScroll:true});ref.current?.scrollIntoView({block:'nearest'});},[email,message]);
 return <div className="email-notice" ref={ref} role="status" tabIndex={-1}><MailCheck size={27} aria-hidden="true"/><div><strong>Check your inbox</strong><p>{email}</p><p>{message}</p><small>Allow a few minutes and check your spam folder. You can request another link after one minute.</small></div></div>;
}
