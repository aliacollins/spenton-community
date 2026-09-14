export const dateValue = (date:Date) => date.toISOString().slice(0,10);
export function validDate(value:string):boolean {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const time=Date.parse(value+'T12:00:00Z');
 return Number.isFinite(time)&&dateValue(new Date(time))===value;
}
export function moveDate(value:string,days:number):string {
 const date=new Date(value+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+days);return dateValue(date);
}
export function moveMonth(value:string,months:number):string {
 const date=new Date(value.slice(0,7)+'-01T12:00:00Z');date.setUTCMonth(date.getUTCMonth()+months);return dateValue(date).slice(0,7);
}
export function calendarDays(month:string):string[] {
 const first=month+'-01',weekday=new Date(first+'T12:00:00Z').getUTCDay();
 return Array.from({length:42},(_,index)=>moveDate(first,index-weekday));
}
export const displayDate=(value:string)=>validDate(value)?new Date(value+'T12:00:00Z').toLocaleDateString('en-US',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}):value;

const shortMonths=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function dateInputText(value:string):string {
 return validDate(value)?`${Number(value.slice(8))} ${shortMonths[Number(value.slice(5,7))-1]} ${value.slice(0,4)}`:value;
}
// Named months avoid locale ambiguity. ISO dates remain accepted for pasting.
export function parseDateInput(text:string):string {
 const value=text.trim();if(validDate(value))return value;
 const match=/^(\d{1,2})\s+([a-z]{3})\s+(\d{4})$/i.exec(value);if(!match)return '';
 const month=shortMonths.findIndex(name=>name.toLowerCase()===match[2].toLowerCase())+1;
 const date=`${match[3]}-${String(month).padStart(2,'0')}-${match[1].padStart(2,'0')}`;
 return month&&Number(match[3])>0&&validDate(date)?date:'';
}
