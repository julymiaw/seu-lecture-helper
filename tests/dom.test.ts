import {beforeEach, describe, expect, it, vi} from 'vitest';
import {Dialog, duration} from '../src/dialog';
import {Mount, matchCard} from '../src/mount';
import {Api} from '../src/api';
import {acquireTask} from '../src/lock';
import raw from './fixtures/activities.json';
import {deferred, fixture, NOW, response, sample} from './helpers';
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


describe('OCR-only dialog',()=>{
  const actions=()=>({choosePair:vi.fn(),prefer:vi.fn(),annotate:vi.fn(),verify:vi.fn(),close:vi.fn(),start:vi.fn(),exportLogs:vi.fn(async()=>{}),hide:vi.fn(),reload:vi.fn(),login:vi.fn(),resume:vi.fn()});
  it('keeps captcha processing invisible without an image, answer or manual controls',async()=>{
    const d=new Dialog(actions()),activity={...await sample(),reserved:false,startsAt:NOW+10000};
    d.render({phase:'prepared',activity,message:'',armed:true,image:'data:image/png;base64,AA==',code:'0733',remaining:10000});
    expect(d.root.querySelector('output')).toBeNull();expect(d.root.querySelector('img')).toBeNull();expect(d.host.dataset.phase).toBe('prepared');expect(d.root.querySelector('input')).toBeNull();expect(d.root.querySelector('form')).toBeNull();expect(d.root.querySelector('[type=submit]')).toBeNull();expect(d.root.querySelector('#refresh')).toBeNull();d.destroy();
  });
  it('removes lead selection and exports through a single compact action',async()=>{
    const a=actions(),d=new Dialog(a),activity={...await sample(),reserved:false,startsAt:NOW+10000};
    d.render({phase:'ready',activity,message:''});expect(d.root.querySelector('#lead')).toBeNull();expect(d.root.querySelector('.settings')).toBeNull();
    d.root.querySelector<HTMLButtonElement>('#export')!.click();await Promise.resolve();expect(a.exportLogs).toHaveBeenCalledTimes(1);
    d.render({phase:'submitting',activity,message:'正在提交',armed:true,image:'image',code:'1234'});expect(d.root.querySelector<HTMLButtonElement>('#close')!.disabled).toBe(true);d.destroy();
  });
  it('keeps the panel collapsed during automatic preparation and retains its phase when reopened',async()=>{
    const d=new Dialog(actions()),activity={...await sample(),reserved:false,startsAt:NOW+10000};d.hide();const s={phase:'prepared' as const,activity,message:'',armed:true,image:'image',code:'1234',remaining:10000};
    d.render(s);expect(d.root.querySelector('dialog')!.open).toBe(false);d.show();d.render({...s,remaining:9000});expect(d.root.querySelector('dialog')!.open).toBe(true);expect(d.host.dataset.phase).toBe('prepared');d.destroy();
  });
  it('renders untrusted titles as text and formats countdown',async()=>{
    const d=new Dialog(actions());d.render({phase:'ready',activity:{...await sample(),title:'<img onerror=bad>'},message:''});expect(d.root.querySelector('h2')!.textContent).toBe('<img onerror=bad>');expect(d.root.querySelector('h2 img')).toBeNull();expect(duration(1001)).toBe('00:00:02');d.destroy();
  });
});
it('candidate dialog adds only one order setting and locks it after start, while showing failure feedback',async()=>{
  const a={choosePair:vi.fn(),prefer:vi.fn(),annotate:vi.fn(),verify:vi.fn(),close:vi.fn(),start:vi.fn(),exportLogs:vi.fn(async()=>{}),hide:vi.fn(),reload:vi.fn(),login:vi.fn(),resume:vi.fn()};
  const d=new Dialog(a),online={...await sample(),id:'on',title:'【线上】同一讲座'},offline={...online,id:'off',title:'【线下】同一讲座'};
  const state={phase:'ready' as const,message:'',activity:online,candidates:[online,offline],preferred:'online' as const};d.render(state);
  d.root.querySelector<HTMLButtonElement>('#offline-first')!.click();expect(a.prefer).toHaveBeenCalledWith('offline');expect(d.root.querySelector('#labels')!.hasAttribute('hidden')).toBe(true);
  d.render({...state,phase:'waiting',armed:true,lastFailure:{target:'线上',message:'人数已满',action:'切换下一候选'}});
  expect(d.root.querySelector<HTMLButtonElement>('#offline-first')!.disabled).toBe(true);expect(d.root.querySelector('#failure')!.textContent).toContain('人数已满');
  d.render({...state,candidates:[online]});expect(d.root.querySelector('#candidates')!.hasAttribute('hidden')).toBe(true);d.destroy();
});
it('pair confirmation uses only the counterpart title, question and two themed buttons',async()=>{
  const a={choosePair:vi.fn(),prefer:vi.fn(),annotate:vi.fn(),verify:vi.fn(),close:vi.fn(),start:vi.fn(),exportLogs:vi.fn(async()=>{}),hide:vi.fn(),reload:vi.fn(),login:vi.fn(),resume:vi.fn()};
  const d=new Dialog(a),online={...await sample(),id:'on',title:'【线上】【艺术】同一讲座'},offline={...online,id:'off',title:'【线下】【艺术】同一讲座'};
  d.render({phase:'choosing',message:'',activity:online,candidates:[online,offline],requestedId:'on'});
  expect(d.root.querySelector('#title')!.textContent).toBe(offline.title);expect(d.root.querySelector('#pair-question')!.textContent).toBe('是否将同一讲座的另一场次也加入候选？');
  expect(d.root.querySelector('#candidates')!.hasAttribute('hidden')).toBe(true);expect(d.root.querySelector('#start')!.hasAttribute('hidden')).toBe(true);expect(d.root.querySelector('#close')!.hasAttribute('hidden')).toBe(true);
  d.root.querySelector<HTMLButtonElement>('#join')!.click();expect(a.choosePair).toHaveBeenCalledWith(true);d.destroy();
});
it('updates each candidate outcome through verification and success, then removes stale failure and challenge actions',async()=>{
  const a={choosePair:vi.fn(),prefer:vi.fn(),annotate:vi.fn(),verify:vi.fn(),close:vi.fn(),start:vi.fn(),exportLogs:vi.fn(async()=>{}),hide:vi.fn(),reload:vi.fn(),login:vi.fn(),resume:vi.fn()};
  const d=new Dialog(a),online={...await sample(),id:'on',title:'【线上】同一讲座'},offline={...online,id:'off',title:'【线下】同一讲座'};
  const state={phase:'verifying' as const,message:'正在核验',activity:offline,candidates:[online,offline],candidateIndex:1,fullIds:['on'],image:'image',code:'1234',lastFailure:{target:'线上',reason:'full',message:'人数已满，请重新选择',action:'切换下一候选'}};
  d.render(state);expect(d.root.querySelectorAll('li')[0].textContent).toContain('已满');expect(d.root.querySelectorAll('li')[1].textContent).toContain('核验中');expect(d.root.querySelector('#failure')!.hasAttribute('hidden')).toBe(true);
  d.render({...state,phase:'success',message:'预约成功'});expect(d.root.querySelectorAll('li')[1].textContent).toContain('预约成功');expect(d.root.querySelectorAll('li')[1].classList.contains('success')).toBe(true);
  expect(d.root.querySelector('#failure')!.textContent).toBe('');expect(d.root.querySelector('[type=submit]')).toBeNull();expect(d.root.querySelector('#refresh')).toBeNull();d.destroy();
});
it('keeps export busy across renders and restores its disabled state during a write',async()=>{
  const pending=deferred<void>(),a={choosePair:vi.fn(),prefer:vi.fn(),annotate:vi.fn(),verify:vi.fn(),close:vi.fn(),start:vi.fn(),exportLogs:vi.fn(()=>pending.promise),hide:vi.fn(),reload:vi.fn(),login:vi.fn(),resume:vi.fn()};
  const d=new Dialog(a),activity=await sample(),button=d.root.querySelector<HTMLButtonElement>('#export')!;d.render({phase:'waiting',message:'',activity,armed:true});button.click();d.render({phase:'waiting',message:'',activity,armed:true});button.click();expect(a.exportLogs).toHaveBeenCalledTimes(1);expect(button.disabled).toBe(true);
  d.render({phase:'submitting',message:'',activity});pending.resolve();await Promise.resolve();expect(button.disabled).toBe(true);d.render({phase:'success',message:'',activity});expect(button.disabled).toBe(false);d.destroy();
});
