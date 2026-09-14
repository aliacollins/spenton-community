import { money } from './engine';
import { sharedDinnerExample } from './public-example';

const root = document.getElementById('try-dinner');
if (root) {
  let maya = false, sam = false;
  const text = (id: string, value: string) => { document.getElementById(id)!.textContent = value; };
  const mayaButton = document.getElementById('try-maya') as HTMLButtonElement;
  const samButton = document.getElementById('try-sam') as HTMLButtonElement;
  const reset = document.getElementById('try-reset') as HTMLButtonElement;
  function render() {
    const totals = sharedDinnerExample((Number(maya) + Number(sam)) * 4000);
    text('try-spending', money(totals.spent));
    text('try-owed', money(totals.shared.receivable));
    text('try-bank', money(totals.cash));
    text('try-ready', money(totals.ready));
    text('try-maya-state', maya ? 'Received' : 'Owes you');
    text('try-sam-state', sam ? 'Received' : 'Owes you');
    document.getElementById('try-maya-state')!.classList.toggle('received', maya);
    document.getElementById('try-sam-state')!.classList.toggle('received', sam);
    mayaButton.disabled = maya; samButton.disabled = sam;
    text('try-result', maya && sam
      ? 'Both repayments are recorded. Your spending stays $40, your bank holds $460, and $80 is available to plan.'
      : maya || sam
        ? `${maya ? 'Maya' : 'Sam'} paid back $40. Your spending stays $40. The other $40 is still owed to you.`
        : 'You paid $120. Your spending is $40, and your friends owe $80. Unpaid amounts are not available cash.');
  }
  mayaButton.addEventListener('click', () => { maya = true; render(); });
  samButton.addEventListener('click', () => { sam = true; render(); });
  reset.addEventListener('click', () => { maya = false; sam = false; render(); });
  root.querySelectorAll<HTMLElement>('[data-demo-control]').forEach(control => { control.hidden = false; });
  render();
}
