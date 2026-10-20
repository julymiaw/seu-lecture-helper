import {readFileSync} from 'node:fs';
import {vi} from 'vitest';
import {Api, type Activity, type ReservationApi} from '../src/api';
import raw from './fixtures/activities.json';
export const fixture = (name: string) => readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8');
export const clone = <T>(x: T): T => structuredClone(x);
export const NOW = Date.parse('2026-10-12T08:00:00Z');
export const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status});
export const envelope = (datas: unknown) => ({code: 0, datas, msg: '', debugException: null});
export async function sample(): Promise<Activity> {
  return (await new Api(vi.fn(async () => response(raw)), () => NOW).list()).activities[0];
}
export async function mockApi(overrides: Partial<ReservationApi> = {}) {
  const a = {...await sample(), reserved: false, startsAt: NOW - 1000};
  return {list: vi.fn(async () => ({activities: [a], clock:clockSample()})), detail: vi.fn(async () => ({activity: a, clock:clockSample()})),
    captcha: vi.fn(async () => 'data:image/jpeg;base64,VEVTVA=='), submit: vi.fn(async () => {}), booked: vi.fn(async () => true), ...overrides};
}
export function deferred<T>() {let resolve!: (x: T) => void; let reject!: (x: unknown) => void; const promise = new Promise<T>((a,b) => {resolve=a; reject=b;}); return {promise,resolve,reject};}
export function trackedStorage() {
  const values=new Map<string,string>();
  return {
    get length(){return values.size;},
    key:(index:number)=>[...values.keys()][index]??null,
    clear:()=>values.clear(),
    getItem:(key:string)=>values.get(key)??null,
    setItem:vi.fn((key:string,value:string)=>{values.set(key,value);}),
    removeItem:(key:string)=>{values.delete(key);},
  };
}

export const clockSample=(offset=0)=>({serverTime:Date.now()+offset,receivedAt:Date.now(),rttMs:0,offset});
