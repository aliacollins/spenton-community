import {id} from './engine';
import type {Category} from './engine';

export const starterSuggestions=[
 ['Home & bills','Rent & home','home','sand'],['Home & bills','Utilities','zap','butter'],['Home & bills','Phone & internet','phone','blue'],
 ['Everyday','Groceries','basket','sage'],['Everyday','Transport','car','blue'],['Everyday','Dining out','food','peach'],
 ['Life & people','Health','health','rose'],['Life & people','Subscriptions','repeat','lavender'],['Life & people','Clothing','shirt','sand'],['Life & people','Pets','paw','peach'],['Life & people','Children','baby','butter'],['Life & people','Education','study','blue'],
 ['Looking ahead','Rainy day fund','umbrella','sage'],['Looking ahead','Travel','plane','blue'],['Looking ahead','Gifts','gift','rose'],
];
export const defaultStarters=['Rent & home','Groceries','Dining out','Rainy day fund'];
export const pipStarterNames=['Rent & home','Utilities','Phone & internet','Groceries','Transport','Dining out','Health','Subscriptions','Rainy day fund','Travel','Gifts'];
export function starterCategories(names:string[]):Category[]{return starterSuggestions.filter(s=>names.includes(s[1])).map(([group,name,icon,color])=>({id:id(),name,group,icon,color,target:0,targetType:'monthly'}));}
