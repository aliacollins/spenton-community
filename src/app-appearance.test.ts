import {afterEach,describe,expect,it,vi} from 'vitest';
import {appearanceKey,DEFAULT_APPEARANCE,parseAppearance,readAppearance,writeAppearance} from './app-appearance';

afterEach(()=>vi.unstubAllGlobals());
describe('optional app appearance',()=>{
 it('retains Current for absent, malformed and unsupported preferences',()=>{
  for(const raw of [null,'{','null','[]','{"view":"pip"}','{"view":"other","motion":true}','{"view":"pip","motion":"false"}']){
   expect(parseAppearance(raw)).toEqual(DEFAULT_APPEARANCE);
  }
  expect(parseAppearance('{"view":"pip","motion":false}')).toEqual({view:'pip',motion:false});
 });
 it('isolates the choice by authenticated account and stores only presentation fields',()=>{
  const data=new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value)});
  expect(writeAppearance('account-a',{view:'pip',motion:false})).toBe(true);
  expect(readAppearance('account-a')).toEqual({view:'pip',motion:false});
  expect(readAppearance('account-b')).toEqual(DEFAULT_APPEARANCE);
  expect(JSON.parse(data.get(appearanceKey('account-a'))!)).toEqual({view:'pip',motion:false});
 });
 it('keeps preference storage failures from breaking the app',()=>{
  vi.stubGlobal('localStorage',{getItem:()=>{throw new Error('Unavailable');},setItem:()=>{throw new Error('Unavailable');}});
  expect(readAppearance('account-a')).toEqual(DEFAULT_APPEARANCE);
  expect(writeAppearance('account-a',{view:'pip',motion:true})).toBe(false);
 });
});
