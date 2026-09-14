import {afterEach,describe,expect,it,vi} from 'vitest';
import {clearFormForRequest,clearSharingDrafts,pendingSharingRequest,readSharingDraft,sharingScope,writeSharingDraft} from './sharing-drafts';

function storage(){
 const values:Record<string,string>={};
 const surface=Object.create(null);
 Object.defineProperties(surface,{
  getItem:{value:(key:string)=>values[key]??null},
  setItem:{value:(key:string,value:string)=>{values[key]=value;Object.defineProperty(surface,key,{value,writable:true,enumerable:true,configurable:true});}},
  removeItem:{value:(key:string)=>{delete values[key];delete surface[key];}},
 });
 vi.stubGlobal('sessionStorage',surface);
}
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
describe('sharing editor recovery',()=>{
 it('isolates accounts and budgets and clears only the signed-out account',()=>{
  storage();const a=sharingScope('alice','one'),b=sharingScope('bob','one');
  writeSharingDraft(a,'create-group',1,{name:'Private trip'});writeSharingDraft(b,'create-group',1,{name:'Another trip'});
  expect(readSharingDraft(sharingScope('alice','two'),'create-group')).toBeNull();
  clearSharingDrafts('alice');expect(readSharingDraft(a,'create-group')).toBeNull();expect(readSharingDraft(b,'create-group')?.fields.name).toBe('Another trip');
 });
 it('retains the original financial request beyond the ordinary draft expiry and rejects unrelated endpoints',()=>{
  storage();vi.useFakeTimers();const scope=sharingScope('alice','one'),request={path:'/shared-expenses',body:{operationId:'10000000-0000-4000-8000-000000000001',groupId:'trip',amount:1234}};
  writeSharingDraft(scope,'pending-groups',1,{request:JSON.stringify(request)});writeSharingDraft(scope,'create-group',1,{name:'Trip'});
  vi.advanceTimersByTime(2*86400000);expect(readSharingDraft(scope,'create-group')).toBeNull();expect(pendingSharingRequest(scope,'groups')).toEqual(request);
  writeSharingDraft(scope,'pending-groups',1,{request:JSON.stringify({...request,path:'/admin/coupons'})});expect(pendingSharingRequest(scope,'groups')).toBeNull();
 });
 it('does not restore a successfully recovered purchase as a new unsaved bill',()=>{
  storage();const scope=sharingScope('alice','one');
  writeSharingDraft(scope,'group-purchase-trip',1,{amount:'10000',merchant:'Train tickets'});
  clearFormForRequest(scope,{path:'/shared-expenses',body:{groupId:'trip'}});
  expect(readSharingDraft(scope,'group-purchase-trip')).toBeNull();
 });
});
it('keeps ordinary and recurring editors separate and clears resolved review choices',()=>{
 storage();const scope=sharingScope('alice','one');
 writeSharingDraft(scope,'group-bill-trip',1,{merchant:'Dinner'});writeSharingDraft(scope,'group-recurring-trip',1,{merchant:'Rent'});
 expect(readSharingDraft(scope,'group-bill-trip')?.fields.merchant).toBe('Dinner');expect(readSharingDraft(scope,'group-recurring-trip')?.fields.merchant).toBe('Rent');
 clearFormForRequest(scope,{path:'/group-bill-series',body:{groupId:'trip'}});expect(readSharingDraft(scope,'group-recurring-trip')).toBeNull();
 writeSharingDraft(scope,'group-bill-review-bill',1,{account:'cash',category:'dining'});
 clearFormForRequest(scope,{path:'/group-bills/bill/confirm',body:{}});expect(readSharingDraft(scope,'group-bill-review-bill')).toBeNull();
});
