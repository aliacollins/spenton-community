export default function LastUsedTag({account=false}:{account?:boolean}){
 return <span className="last-used-tag" aria-hidden="true" data-tooltip={account?'Last successful sign-in for this account':'Last successful sign-in on this browser'}>Last used</span>;
}
