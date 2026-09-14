export const PROVIDERS=[['google','Google'],['microsoft','Microsoft'],['apple','Apple']];

export function socialConfiguration(env=process.env,{allowRegistration,secureCookies}){
 const providers={};
 for(const [id]of PROVIDERS){
  const key=id.toUpperCase(),clientId=env[key+'_CLIENT_ID'],clientSecret=env[key+'_CLIENT_SECRET'];
  if(!clientId||!clientSecret)continue;
  if(id==='apple'&&!secureCookies)continue;
  providers[id]={clientId,clientSecret,disableSignUp:!allowRegistration,...(id==='google'?{prompt:'select_account',accessType:'online',includeGrantedScopes:false}:id==='microsoft'?{tenantId:'consumers',prompt:'select_account',disableDefaultScope:true,scope:['openid','profile','email'],disableProfilePhoto:true}:{})};
 }
 return providers;
}
