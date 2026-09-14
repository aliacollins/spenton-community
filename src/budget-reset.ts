import {blankBudget,isSharedEntry,today,validateBudget} from './engine';
import type {Budget} from './engine';

export function budgetResetRestriction(b:Budget,plannedShareCount=0):string|null {
 if(b.entries.some(e=>isSharedEntry(e)||e.kind.startsWith('shared_')))return 'This budget contains shared bills or repayments. Resetting or replacing it would remove records that other people still rely on.';
 if(plannedShareCount>0)return 'This budget contains scheduled shared bills. Review their people and shares in the iPhone app before removing them.';
 return null;
}

export function freshBudgetForReplacement(b:Budget,currency=b.currency):Budget {
 const restriction=budgetResetRestriction(b);
 if(restriction)throw new Error(restriction);
 return {...blankBudget(currency),version:b.version};
}

export function resetBudget(b:Budget,mode:'factory'|'structure'):Budget {
 const fresh=freshBudgetForReplacement(b);
 if(mode==='factory')return fresh;
 return validateBudget({...fresh,name:b.name,groups:b.groups,
  accounts:b.accounts.map(a=>({id:a.id,name:a.name,type:a.type,opening:0,date:today(),lastFour:''})),
  categories:b.categories.map(c=>({id:c.id,name:c.name,group:c.group,parentId:c.parentId,icon:c.icon,color:c.color,target:0,targetType:'monthly'}))});
}
