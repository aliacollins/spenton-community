import {validateBudget} from './engine';
import type {Budget} from './engine';

export function budgetImportIssue(budget:Budget):string|null {
 if(budget.entries.some(entry=>entry.kind.startsWith('shared_')||entry.sharedExpenseId||entry.sharedShareId||entry.sharedSettlementId||entry.sharedAmount!==undefined||entry.sharedReduction!==undefined))
  return 'This budget contains linked shared bills. Importing those relationships separately is not supported yet. Keep this export, or restore a complete server backup.';
 return null;
}

// Import budget documents only. Exported identity, sessions and access grants
// never participate in creating a budget in the current authenticated account.
export function budgetsFromBackup(value:unknown):Budget[]{
 let documents:unknown[];
 if(value&&typeof value==='object'&&'format' in value&&value.format==='spenton-account-export'){
  if(!('version' in value)||value.version!==1||!('budgets' in value)||!Array.isArray(value.budgets)||value.budgets.length>100)throw new Error('This account export is not supported.');
  documents=value.budgets.map(row=>row?.budget);
  if(!documents.length)throw new Error('This account export contains no budgets.');
 }else documents=[value];
 return documents.map(document=>{const budget=validateBudget(document);if(budget.demo)throw new Error('Import a backup of your own budget. The fictional sample cannot be imported.');return budget;});
}
