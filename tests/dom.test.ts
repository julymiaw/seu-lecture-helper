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
describe('dialog', () => {
  it('offers a school-page refresh only after confirmed success',()=>{
    const reload=vi.fn(),dialog=new Dialog({submit:vi.fn(),refresh:vi.fn(),verify:vi.fn(),close:vi.fn(),reload});
    dialog.render({phase:'verifying',message:'核验中'});expect(dialog.root.querySelector<HTMLButtonElement>('#reload')!.hidden).toBe(true);
    dialog.render({phase:'success',message:'已核验'});dialog.root.querySelector<HTMLButtonElement>('#reload')!.click();expect(reload).toHaveBeenCalledOnce();dialog.destroy();
  });
  it('lets the user select a mode during countdown and locks it during submission',async()=>{
    const mode=vi.fn(),dialog=new Dialog({submit:vi.fn(),refresh:vi.fn(),verify:vi.fn(),close:vi.fn(),mode});
    dialog.render({phase:'waiting',activity:{...await sample(),reserved:false},message:'等待',mode:'ocr',ocrStatus:'loading',ocrMessage:'正在准备',remaining:10000});
    const manual=dialog.root.querySelector<HTMLInputElement>('[value=manual]')!; manual.click(); expect(mode).toHaveBeenCalledWith('manual');
    expect(dialog.root.querySelector('#mode-hint')!.textContent).toContain('自动提交');
    dialog.render({phase:'submitting',message:'提交中',mode:'ocr'}); expect(manual.disabled).toBe(true); dialog.destroy();
  });
  it('renders the full image, focuses input and sends form submissions', async () => {
    const actions={submit:vi.fn(),refresh:vi.fn(),verify:vi.fn(),close:vi.fn()}; const dialog=new Dialog(actions);
    const image='data:image/jpeg;base64,VEVTVA=='; dialog.render({phase:'input',activity:{...await sample(),reserved:false},message:'输入',image});
    const root=dialog.root, input=root.querySelector<HTMLInputElement>('input[aria-label="验证码"]')!;
    expect(root.querySelector('img')!.getAttribute('src')).toBe(image); expect(root.activeElement).toBe(input);
    input.value='AB12'; root.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true})); expect(actions.submit).toHaveBeenCalledWith('AB12');
    dialog.render({phase:'submitting',message:'提交中',image}); root.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true})); expect(actions.submit).toHaveBeenCalledTimes(1);
    expect(root.querySelector<HTMLButtonElement>('#close')!.disabled).toBe(true);
    dialog.render({phase:'input',activity:{...await sample(),reserved:false},message:'新图',image:'data:image/jpeg;base64,TkVX'}); expect(input.value).toBe(''); expect(root.activeElement).toBe(input);
    dialog.destroy(); expect(dialog.host.isConnected).toBe(false);
  });
  it('prevents IME Enter submission and provides refresh/recheck/close', async () => {
    const actions={submit:vi.fn(),refresh:vi.fn(),verify:vi.fn(),close:vi.fn()}; const dialog=new Dialog(actions);
    dialog.render({phase:'input',activity:{...await sample(),reserved:false},message:'输入',image:'data:image/jpeg;base64,VEVTVA=='});
    const event=new KeyboardEvent('keydown',{key:'Enter',isComposing:true,cancelable:true}); dialog.root.querySelector('input[aria-label="验证码"]')!.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
    dialog.root.querySelector<HTMLButtonElement>('#refresh')!.click(); expect(actions.refresh).toHaveBeenCalledTimes(1);
    dialog.render({phase:'unknown',message:'待确认'}); dialog.root.querySelector<HTMLButtonElement>('#verify')!.click(); expect(actions.verify).toHaveBeenCalledTimes(1);
    dialog.root.querySelector<HTMLButtonElement>('#close')!.click(); expect(actions.close).toHaveBeenCalledTimes(1); dialog.destroy();
  });
  it('uses text nodes for untrusted titles and countdown rounds upward', async () => {
    const dialog=new Dialog({submit:vi.fn(),refresh:vi.fn(),verify:vi.fn(),close:vi.fn()});
    dialog.render({phase:'waiting',message:'wait',remaining:1001,activity:{...await sample(),title:'<img src=x onerror=alert(1)>'}});
    expect(dialog.root.querySelector('h2')!.textContent).toContain('<img'); expect(dialog.root.querySelector('h2 img')).toBeNull();
    expect(dialog.root.querySelector('.clock')!.textContent).toBe('00:00:02'); expect(duration(3600000)).toBe('01:00:00'); dialog.destroy();
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

describe('monitor controls',()=>{
  it('places check-now immediately left of stop, disables it while querying, and only unlocks manual mode on fallback',async()=>{
    const checkNow=vi.fn(),dialog=new Dialog({submit:vi.fn(),refresh:vi.fn(),verify:vi.fn(),close:vi.fn(),checkNow});
    const activity={...await sample(),reserved:false,count:150,capacity:150,countKnown:true};
    const state={phase:'monitoring' as const,message:'正在等待空余名额',activity,taskMode:'monitor' as const,mode:'ocr' as const};
    dialog.render(state);const button=dialog.root.querySelector<HTMLButtonElement>('#check-now')!;
    expect(button.nextElementSibling?.id).toBe('close');expect(button.hidden).toBe(false);button.click();expect(checkNow).toHaveBeenCalledOnce();
    expect(dialog.root.querySelector<HTMLInputElement>('[value=manual]')!.disabled).toBe(true);
    dialog.render({...state,checking:true});expect(button.disabled).toBe(true);button.click();expect(checkNow).toHaveBeenCalledOnce();
    dialog.render({...state,checking:false,manualFallback:true,mode:'manual'});expect(button.disabled).toBe(false);
    expect(dialog.root.querySelector<HTMLInputElement>('[value=manual]')!.disabled).toBe(false);
    dialog.render({...state,phase:'input',image:'data:image/jpeg;base64,VEVTVA=='});expect(button.hidden).toBe(true);dialog.destroy();
  });
  it('disables scheduled booking for full events and keeps monitoring usable after rejection',async()=>{
    const dialog=new Dialog({submit:vi.fn(),refresh:vi.fn(),verify:vi.fn(),close:vi.fn()});
    const activity={...await sample(),reserved:false,count:150,capacity:150,countKnown:true};
    const scheduled=dialog.root.querySelector<HTMLInputElement>('[name=task-mode][value=scheduled]')!;
    const monitor=dialog.root.querySelector<HTMLInputElement>('[name=task-mode][value=monitor]')!;
    dialog.render({phase:'ready',message:'选择预约方式后开始',activity,taskMode:'monitor'});
    expect(scheduled.disabled).toBe(true);expect(monitor.disabled).toBe(false);
    dialog.render({phase:'ready',message:'当前活动预约人数已满，请重新选择',activity:{...activity,countKnown:false},taskMode:'monitor',full:true,error:true});
    expect(scheduled.disabled).toBe(true);expect(monitor.disabled).toBe(false);
    expect(dialog.root.querySelector('#status')!.classList.contains('sr-only')).toBe(false);
    expect(dialog.root.querySelector<HTMLButtonElement>('#start')!.disabled).toBe(false);
    for(const phase of ['submitting','verifying','unknown','success','failed'] as const){
      dialog.render({phase,message:'状态',activity:{...activity,count:149},taskMode:'scheduled'});
      expect(scheduled.disabled).toBe(true);expect(monitor.disabled).toBe(true);
      expect([...dialog.root.querySelectorAll<HTMLInputElement>('[name=mode]')].every(input=>input.disabled)).toBe(true);
    }
    dialog.destroy();
  });
  it('offers explicit start, interval and pause controls; hiding retains the same dialog',async()=>{
    const start=vi.fn(),pause=vi.fn(),configure=vi.fn(),hide=vi.fn();
    const dialog=new Dialog({submit:vi.fn(),refresh:vi.fn(),verify:vi.fn(),close:vi.fn(),start,pause,configure,hide});
    const activity={...await sample(),reserved:false,count:150,capacity:150,countKnown:true};
    dialog.render({phase:'ready',message:'人数已满',activity,taskMode:'monitor',interval:60});
    expect(dialog.root.querySelector<HTMLInputElement>('[name=task-mode][value=monitor]')!.checked).toBe(true);
    dialog.root.querySelector<HTMLButtonElement>('#start')!.click();expect(start).toHaveBeenCalledOnce();
    const interval=dialog.root.querySelector<HTMLSelectElement>('#interval')!;interval.value='30';interval.dispatchEvent(new Event('change'));expect(configure).toHaveBeenCalledWith({interval:30});
    dialog.render({phase:'monitoring',message:'正在等待空余名额',activity,taskMode:'monitor',interval:30,nextCheck:NOW+30000,lastChecked:NOW,remaining:30000});
    expect(dialog.root.querySelector('#capacity')!.textContent).toContain('150 / 150');expect(dialog.root.querySelector('#checked')!.textContent).toContain('上次检查');
    dialog.root.querySelector<HTMLButtonElement>('#pause')!.click();expect(pause).toHaveBeenCalledOnce();
    dialog.root.querySelector<HTMLButtonElement>('#shrink')!.click();expect(hide).toHaveBeenCalledOnce();
    dialog.hide();dialog.render({phase:'monitoring',message:'等待',taskMode:'monitor',remaining:20000,nextCheck:NOW+20000});expect(dialog.root.querySelector('dialog')!.open).toBe(false);
    dialog.show();expect(dialog.root.querySelector('dialog')!.open).toBe(true);dialog.destroy();
  });
  it('automatically reopens a minimized dialog for a challenge and focuses manual input',async()=>{
    const dialog=new Dialog({submit:vi.fn(),refresh:vi.fn(),verify:vi.fn(),close:vi.fn()});dialog.hide();
    dialog.render({phase:'input',activity:{...await sample(),reserved:false},message:'请输入',image:'data:image/jpeg;base64,VEVTVA==',taskMode:'monitor'});
    expect(dialog.root.querySelector('dialog')!.open).toBe(true);expect(dialog.root.activeElement).toBe(dialog.root.querySelector('[aria-label=验证码]'));dialog.destroy();
  });
  it('selects follow-up before waiting and does not expose captcha retry for terminal failures',async()=>{
    const configure=vi.fn();const dialog=new Dialog({submit:vi.fn(),refresh:vi.fn(),verify:vi.fn(),close:vi.fn(),configure});
    dialog.render({phase:'ready',activity:{...await sample(),reserved:false},message:'开始',taskMode:'scheduled',followUp:false});dialog.root.querySelector<HTMLInputElement>('#follow-up')!.click();expect(configure).toHaveBeenCalledWith({followUp:true});
    dialog.render({phase:'failed',message:'限流'});expect(dialog.root.querySelector<HTMLButtonElement>('#refresh')!.hidden).toBe(true);dialog.destroy();
  });
  it('keeps a single mounted button and updates the running label',async()=>{
    document.body.innerHTML=fixture('list.html');const data=await new Api(vi.fn(async()=>response(raw)),()=>NOW).list();data.activities[0].reserved=false;
    const mount=new Mount({list:vi.fn(async()=>data)},vi.fn());mount.start();await Promise.resolve();await Promise.resolve();mount.scan();
    mount.setActive(data.activities[0].id,'监测中');const button=document.querySelector<HTMLButtonElement>('.seu-lecture-helper-button')!;expect(button.textContent).toBe('监测中');
    mount.setActive(data.activities[0].id,'已暂停');expect(button.textContent).toBe('已暂停');mount.setActive();expect(button.textContent).toBe('预约助手');mount.stop();
  });
});
