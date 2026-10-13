import {beforeEach, describe, expect, it, vi} from 'vitest';
import {Dialog, duration} from '../src/dialog';
import {Mount, matchCard} from '../src/mount';
import {Api} from '../src/api';
import {acquireTask} from '../src/lock';
import raw from './fixtures/activities.json';
import {clone, deferred, fixture, NOW, response, sample} from './helpers';
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  HTMLDialogElement.prototype.showModal = function() {this.setAttribute('open','');};
  HTMLDialogElement.prototype.close = function() {this.removeAttribute('open');};
  history.replaceState(null,'','/#/hdyy');
});
describe('mounting', () => {
  it('shows initial and verified booking states, including when an older list resolves late', async()=>{
    document.body.innerHTML=fixture('list.html');
    const data=await new Api(vi.fn(async()=>response(raw)),()=>NOW).list();
    data.activities[0].reserved=false;
    const pending=deferred<typeof data>();
    const card=document.querySelector('.activity-container')!;
    Object.assign(card,{__vue__:{$props:{item:{WID:data.activities[0].id}}}});
    const mount=new Mount({list:()=>pending.promise},vi.fn());mount.start();
    mount.setReserved(data.activities[0].id,true);
    expect(card.querySelector('button.seu-lecture-helper-button')!.textContent).toBe('已预约');
    pending.resolve(data);await Promise.resolve();await Promise.resolve();mount.scan();
    expect(card.querySelector('button.seu-lecture-helper-button')!.textContent).toBe('已预约');
    mount.setReserved(data.activities[0].id,false);
    expect(card.querySelector('button.seu-lecture-helper-button')!.textContent).toBe('预约助手');mount.stop();
  });
  const list = () => new Api(vi.fn(async()=>response(raw)),()=>NOW).list();
  it('mounts actual cards without ordering assumptions or triggering native click', async () => {
    document.body.innerHTML=fixture('list.html'); const data=await list(); const open=vi.fn();
    const mount=new Mount({list:vi.fn(async()=>data)},open); mount.start(); await Promise.resolve(); await Promise.resolve(); mount.scan();
    const cards=[...document.querySelectorAll('.activity-container')];
    expect(document.querySelectorAll('.seu-lecture-helper-button')).toHaveLength(2);
    const native=vi.fn(); cards[0].addEventListener('click',native);
    cards[0].querySelector<HTMLButtonElement>('.seu-lecture-helper-button')!.click(); expect(open).toHaveBeenCalledWith(data.activities[0].id); expect(native).not.toHaveBeenCalled();
    cards[0].parentElement!.append(cards[0]); mount.scan(); mount.scan(); expect(document.querySelectorAll('.seu-lecture-helper-button')).toHaveLength(2); mount.stop();
  });
  it('uses readonly Vue ID even when no interface data was loaded', () => {
    document.body.innerHTML=fixture('list.html'); const card=document.querySelector('.activity-container')!;
    Object.assign(card,{__vue__:{$parent:{$props:{item:{WID:'exact-id'}}}}});
    expect(matchCard(card,[])).toBe('exact-id');
  });
  it('refuses ambiguous fallback matches', async () => {
    document.body.innerHTML=fixture('list.html'); const data=await list(); const card=document.querySelector('.activity-container')!;
    expect(matchCard(card,[data.activities[0],{...data.activities[0],id:'duplicate'}])).toBeUndefined();
  });
  it('does not mount hidden cards or the my-activities tab', async () => {
    document.body.innerHTML=fixture('list.html'); const data=await list();
    const card=document.querySelector<HTMLElement>('.activity-container')!; card.style.display='none';
    const mount=new Mount({list:vi.fn(async()=>data)},vi.fn()); mount.start(); await Promise.resolve(); await Promise.resolve(); mount.scan();
    expect(document.querySelectorAll('.seu-lecture-helper-button')).toHaveLength(1);
    const nav=document.createElement('div'); nav.className='mint-navbar'; nav.innerHTML='<a class="is-selected">我的活动</a>'; document.querySelector('.hdyy')!.prepend(nav); mount.scan();
    expect(document.querySelectorAll('.seu-lecture-helper-button')).toHaveLength(0); mount.stop();
  });
  it('handles detail IDs, route changes, DOM replacement and cleanup', async () => {
    document.body.innerHTML=fixture('detail.html'); history.replaceState(null,'','/#/hdxq?WID=detail-id');
    const open=vi.fn(), route=vi.fn(); const mount=new Mount({list:vi.fn(async()=>({activities:[],offset:0}))},open,route); mount.start(); mount.scan();
    document.querySelector<HTMLButtonElement>('.seu-lecture-helper-button')!.click(); expect(open).toHaveBeenCalledWith('detail-id');
    const foot=document.querySelector('.hdxq-foot')!; foot.innerHTML='<button>预约</button>'; mount.scan(); expect(foot.querySelectorAll('.seu-lecture-helper-button')).toHaveLength(1);
    history.replaceState(null,'','/#/other'); window.dispatchEvent(new HashChangeEvent('hashchange')); expect(route).toHaveBeenCalled(); expect(document.querySelector('.seu-lecture-helper-button')).toBeNull(); mount.stop();
  });
});
describe('cross-tab task lock', () => {
  it('atomically rejects a second task and releases for a later task', async () => {
    let held=false;
    const locks={request:vi.fn(async (_:string,__:unknown,fn:(lock:unknown)=>Promise<void>)=>{
      if(held) return fn(null); held=true; try{return await fn({name:'test'});}finally{held=false;}
    })} as unknown as LockManager;
    const first=await acquireTask(locks); expect(first).toBeTypeOf('function'); expect(await acquireTask(locks)).toBeNull(); first!(); await Promise.resolve(); await Promise.resolve();
    const next=await acquireTask(locks); expect(next).toBeTypeOf('function'); next!();
  });
  it('does not silently run without supported task exclusion', async () => {
    await expect(acquireTask(undefined)).rejects.toThrow('不支持');
  });
});


describe('unified captcha dialog',()=>{
  const actions=()=>({submit:vi.fn(),edit:vi.fn(),refresh:vi.fn(),verify:vi.fn(),close:vi.fn(),start:vi.fn(),configure:vi.fn(),hide:vi.fn(),reload:vi.fn()});
  it('shows OCR text and image together and sends human edits to task state',async()=>{
    const a=actions(),d=new Dialog(a),activity={...await sample(),reserved:false,startsAt:NOW+10000};
    d.render({phase:'input',activity,message:'',armed:true,image:'data:image/png;base64,AA==',code:'0733',remaining:10000});
    const input=d.root.querySelector('input')!;expect(input.value).toBe('0733');expect(input.disabled).toBe(false);
    input.value='0006';input.dispatchEvent(new Event('input'));expect(a.edit).toHaveBeenCalledWith('0006');
    expect(d.root.querySelector('[type=submit]')?.hasAttribute('hidden')).toBe(true);
    expect(d.root.querySelectorAll('[type=radio]')).toHaveLength(0);d.destroy();
  });
  it('offers lead-time selection only before start and locks during writes',async()=>{
    const a=actions(),d=new Dialog(a),activity={...await sample(),reserved:false,startsAt:NOW+10000};
    d.render({phase:'ready',activity,message:'',leadSeconds:30});const select=d.root.querySelector('select')!;
    select.value='10';select.dispatchEvent(new Event('change'));expect(a.configure).toHaveBeenCalledWith(10);
    d.render({phase:'submitting',activity,message:'正在提交',armed:true,image:'image',code:'1234'});
    expect(select.disabled).toBe(true);expect(d.root.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
    expect(d.root.querySelector<HTMLButtonElement>('#close')!.disabled).toBe(true);d.destroy();
  });
  it('reopens for the challenge and preserves the focused input across ticks',async()=>{
    const d=new Dialog(actions()),activity={...await sample(),reserved:false,startsAt:NOW+10000};d.hide();
    const s={phase:'input' as const,activity,message:'',armed:true,image:'image',code:'1234',remaining:10000};d.render(s);
    expect(d.root.querySelector('dialog')!.open).toBe(true);const input=d.root.querySelector('input')!;expect(d.root.activeElement).toBe(input);input.setSelectionRange(2,2);
    d.render({...s,remaining:9000});expect(input.selectionStart).toBe(2);d.destroy();
  });
  it('renders untrusted titles as text and formats countdown',async()=>{
    const d=new Dialog(actions());d.render({phase:'ready',activity:{...await sample(),title:'<img onerror=bad>'},message:''});expect(d.root.querySelector('h2')!.textContent).toBe('<img onerror=bad>');expect(d.root.querySelector('h2 img')).toBeNull();expect(duration(1001)).toBe('00:00:02');d.destroy();
  });
});
