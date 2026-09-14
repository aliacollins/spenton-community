export const selfHostedPage = document.querySelector('meta[name="spenton-deployment"]')?.getAttribute('content') === 'self-hosted';

export default function SelfHostedPolicy({terms=false}:{terms?:boolean}) {
 return <main className="privacy-page">
  <a href="/" className="cloud-brand"><img src="/brand/spenton-symbol.svg" alt=""/><span>SpentOn</span></a>
  <h1>{terms?'Using this SpentOn server':'Your data on this server'}</h1>
  <p className="privacy-intro">You are using an independently hosted SpentOn installation at <strong>{location.host}</strong>. Its operator manages the server, access, updates and backups.</p>
  {terms?<><h2>Your account</h2><p>No SpentOn Cloud subscription is required. Contact the person who operates this server for its usage rules and support.</p><h2>Your records</h2><p>SpentOn records budgets, expenses and repayments. It does not connect to your bank or send money. Check amounts and confirm changes before saving.</p></>:<><h2>Where records are stored</h2><p>Your account and saved budgets are sent to this server. Its operator controls the database and backups. Self-hosting does not provide end-to-end encryption.</p><h2>Optional services</h2><p>The standard self-hosted setup uses local usernames and passwords without an email service. If you enable bill scanning, submitted bill images or text are processed through the configured scanning service. Review its consent screen before sending a bill.</p><h2>Shared bills</h2><p>People included in a shared bill can access its shared details and included receipt. Personal budgets remain separate. Sharing works between accounts on this server.</p><h2>Your controls</h2><p>Use Account &amp; privacy to export your account data or delete your account using your password. Contact this server’s operator about its retention, backup and privacy policies.</p></>}
  <a className="button secondary" href="/app">Return to SpentOn</a>
 </main>;
}
