import './privacy.css';

export default function TermsPage(){
 return <main className="privacy-page">
  <a href="/" className="cloud-brand"><img src="/brand/spenton-symbol.svg" alt=""/><span>SpentOn</span></a>
  <h1>Using SpentOn Cloud.</h1>
  <p className="privacy-meta">Terms of use · Updated 14 September 2026</p>
  <p>SpentOn is operated by Arpan Jha as an individual. These terms describe the official SpentOn Cloud beta. The upcoming self-hosted software has its own license; using it does not require a Cloud subscription. For help, contact <a href="mailto:support@spenton.dev">support@spenton.dev</a>.</p>
  <h2>What SpentOn Cloud provides</h2>
  <p>SpentOn helps you plan spending and savings, record transactions and review account balances using information you enter or import. It does not connect to your bank or read your email. Check your records against your bank statements. The app provides budgeting information, not financial, tax, legal or investment advice.</p>
  <h2>Your account</h2>
  <p>You must be at least 18 and provide accurate account information. Keep your sign-in details secure and only enter or import information you own or are authorised to use. Do not attempt to access another person's account, interfere with the service or use it for an unlawful purpose.</p>
  <h2 id="billing">Cloud trial and payments</h2>
  <p>New accounts receive a 40-day trial without a payment card. Paid checkout is disabled for this beta, so creating an account does not start a subscription or authorise a charge. After your access period ends, you can still view and export your saved budgets; editing requires active access.</p>
  <p>Any future paid purchase will require a separate choice and will show its price and payment terms before you confirm. Questions about an earlier payment can be sent to support@spenton.dev. These beta terms do not change the terms that applied to an earlier purchase.</p>
  <h2>Your information</h2>
  <p>The <a href="/privacy">privacy notice</a> explains what the service stores and how it is used. You can export your information or request account deletion in Account &amp; privacy. Keep copies of important records; daily backups can omit changes made since the last successful snapshot.</p>
  <h2>Beta availability and changes</h2>
  <p>The beta may contain errors or be unavailable during maintenance. Features and these terms may change as the service develops. Material changes will be communicated, and you can stop using the service and request deletion of your account at any time. Nothing on this page limits rights you have under applicable law.</p>
  <p><a href="/app">Open SpentOn</a> · <a href="/privacy">Privacy notice</a></p>
 </main>;
}
