import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ApiError, type Activity} from '../src/api';
import {controls, Reservation} from '../src/reservation';
import {deferred, mockApi, NOW, sample} from './helpers';
const flush=async()=>{for(let i=0;i<25;i++)await Promise.resolve();};
const FULL_MESSAGE='当前活动预约人数已满，请重新选择';
async function setup(full=false) {
  const item:Activity={...await sample(),reserved:false,count:full?150:149,capacity:150,countKnown:true,startsAt:NOW-1000,endsAt:NOW+3600000};
  const base=await mockApi();
  const api={...base,list:vi.fn(async()=>({activities:[{...item}],offset:0})),submit:vi.fn(base.submit),booked:vi.fn(base.booked)};
  const ocr={prepare:vi.fn(async()=>{}),recognize:vi.fn(async()=> '3253')};
  const task=new Reservation(api,vi.fn(),Date.now,()=>true,ocr,'manual',()=>0.5);
  await task.open(item.id,false);return {item,api,ocr,task};
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(NOW);});
describe('reservation controls and transitions',()=>{
  it('monitoring forces OCR and ignores manual selection without changing scheduled preference',async()=>{
    const {task}=await setup();task.configure({taskMode:'monitor'});await flush();
    expect(task.state).toMatchObject({mode:'ocr',manualFallback:false});expect(controls(task.state).manual).toBe(false);
    task.setMode('manual');expect(task.state.mode).toBe('ocr');
    task.configure({taskMode:'scheduled'});expect(task.state.mode).toBe('manual');task.close();
  });
  it.each(['recognition','prepare','captcha'] as const)('a monitoring %s error unlocks manual fallback without looping',async failure=>{
    const {task,api,ocr}=await setup();
    if(failure==='prepare')ocr.prepare.mockRejectedValue(new Error('offline'));
    if(failure==='recognition')ocr.recognize.mockResolvedValue('123');
    if(failure==='captcha')api.submit.mockRejectedValue(new ApiError('验证码错误','business'));
    task.configure({taskMode:'monitor'});task.start();await flush();
    expect(task.state).toMatchObject({phase:'input',mode:'manual',manualFallback:true});
    expect(controls(task.state).manual).toBe(true);expect(api.submit).toHaveBeenCalledTimes(failure==='captcha'?1:0);
    await vi.advanceTimersByTimeAsync(120000);expect(api.submit).toHaveBeenCalledTimes(failure==='captcha'?1:0);task.close();
  });
  it('a full event cannot select scheduled booking, fetch captcha or submit through any entry point',async()=>{
    const {task,api}=await setup(true);expect(controls(task.state).scheduled).toBe(false);
    task.configure({taskMode:'scheduled'});expect(task.state.taskMode).toBe('monitor');
    await task.loadCaptcha();expect(task.state.phase).toBe('ready');expect(api.captcha).not.toHaveBeenCalled();
    // Even a stale UI / external caller cannot bypass the model guard.
    task.state={...task.state,phase:'input',taskMode:'scheduled',image:'data:image/jpeg;base64,VEVTVA=='};
    await task.submit('3253');expect(task.state).toMatchObject({phase:'ready',taskMode:'monitor',image:undefined});
    task.state={...task.state,taskMode:'scheduled'};task.start();expect(task.state.taskMode).toBe('monitor');
    expect(api.submit).not.toHaveBeenCalled();expect(api.captcha).not.toHaveBeenCalled();task.close();
  });
  it('full-event manual/OCR toggles and repeated start clicks never take a challenge',async()=>{
    const {task,api,ocr}=await setup(true);task.configure({taskMode:'scheduled'});task.setMode('ocr');await flush();task.setMode('manual');
    task.start();task.start();await flush();task.setMode('ocr');await flush();await vi.advanceTimersByTimeAsync(60000);
    expect(task.state.phase).toBe('monitoring');expect(api.list).toHaveBeenCalledTimes(3);expect(api.captcha).not.toHaveBeenCalled();expect(api.submit).not.toHaveBeenCalled();expect(ocr.recognize).not.toHaveBeenCalled();task.close();
  });
  it('switching from a manual challenge to monitoring clears it and OCR cannot submit the old challenge',async()=>{
    const {task,api,ocr,item}=await setup();task.start();await flush();expect(task.state.phase).toBe('input');
    task.configure({taskMode:'monitor'});expect(task.state).toMatchObject({phase:'ready',image:undefined,taskMode:'monitor'});
    task.setMode('ocr');await flush();expect(ocr.recognize).not.toHaveBeenCalled();expect(api.submit).not.toHaveBeenCalled();
    item.count=150;task.start();await flush();expect(task.state.phase).toBe('monitoring');expect(api.captcha).toHaveBeenCalledTimes(1);task.close();
  });
  it.each(['captcha','recognition'] as const)('drops a late %s result after switching tasks',async kind=>{
    const {task,api,ocr}=await setup();const pending=deferred<string>();
    if(kind==='captcha')api.captcha=vi.fn(()=>pending.promise);else{ocr.recognize=vi.fn(()=>pending.promise);task.setMode('ocr');}
    task.start();await flush();expect(task.state.phase).toBe(kind==='captcha'?'captcha-loading':'recognizing');
    task.configure({taskMode:'monitor'});pending.resolve(kind==='captcha'?'data:image/jpeg;base64,VEVTVA==':'3253');await flush();
    expect(task.state).toMatchObject({phase:'ready',taskMode:'monitor',image:undefined});expect(api.submit).not.toHaveBeenCalled();task.close();
  });
  it('switching a countdown cancels its timer and leaves monitoring waiting for explicit start',async()=>{
    const {task,api,item}=await setup();item.startsAt=NOW+5000;await task.open(item.id,false);task.start();expect(task.state.phase).toBe('waiting');
    task.configure({taskMode:'monitor'});await vi.advanceTimersByTimeAsync(10000);
    expect(task.state.phase).toBe('ready');expect(api.captcha).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);task.close();
  });
  it('the real full-capacity message returns a direct booking to usable monitoring controls',async()=>{
    const {task,api,ocr}=await setup();api.submit.mockRejectedValue(new ApiError(FULL_MESSAGE,'business'));
    task.start();await flush();task.setMode('ocr');await flush();
    expect(api.submit).toHaveBeenCalledTimes(1);expect(task.state).toMatchObject({phase:'ready',taskMode:'monitor',full:true,error:true,image:undefined});
    expect(controls(task.state)).toMatchObject({scheduled:false,monitor:true,mode:true,start:true,submit:false});
    task.setMode('manual');task.setMode('ocr');await flush();expect(ocr.recognize).toHaveBeenCalledTimes(1);expect(api.submit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120000);expect(api.list).toHaveBeenCalledTimes(1);task.close();
  });
  it('full-capacity OCR failure during monitoring waits the full polling interval and can recognize the next challenge',async()=>{
    const {task,api}=await setup();api.submit.mockRejectedValueOnce(new ApiError(FULL_MESSAGE,'business'));task.configure({taskMode:'monitor'});task.setMode('ocr');task.start();await flush();
    expect(task.state.phase).toBe('monitoring');expect(api.list).toHaveBeenCalledTimes(2);expect(api.submit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59999);expect(api.list).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);await flush();expect(api.submit).toHaveBeenCalledTimes(2);expect(task.state.phase).toBe('success');task.close();
  });
  it('submission and unknown outcomes reject task and OCR switches until verification is resolved',async()=>{
    const {task,api}=await setup();const pending=deferred<void>();api.submit.mockImplementationOnce(()=>pending.promise);api.booked.mockResolvedValue(false);
    task.start();await flush();const write=task.submit('3253');task.configure({taskMode:'monitor'});task.setMode('ocr');
    expect(task.state).toMatchObject({phase:'submitting',taskMode:'scheduled',mode:'manual'});
    pending.resolve();await vi.advanceTimersByTimeAsync(3000);await write;
    expect(task.state.phase).toBe('unknown');task.configure({taskMode:'monitor'});task.setMode('ocr');await flush();
    expect(controls(task.state)).toMatchObject({scheduled:false,monitor:false,mode:false,start:false,submit:false});expect(api.submit).toHaveBeenCalledTimes(1);task.close();
  });
  it('an event expiring while input is open cannot submit or start OCR',async()=>{
    const {task,api,ocr,item}=await setup();task.start();await flush();vi.setSystemTime(item.endsAt);
    task.setMode('ocr');await task.submit('3253');expect(task.state.phase).toBe('failed');expect(api.submit).not.toHaveBeenCalled();expect(ocr.recognize).not.toHaveBeenCalled();task.close();
  });
});
