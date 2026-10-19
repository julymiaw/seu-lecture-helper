import {expect,it,vi} from 'vitest';
import {Reservation,controls} from '../src/reservation';
import {ApiError} from '../src/api';
import {mockApi,sample,NOW,deferred} from './helpers';
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
async function setup(options:{future?:number;ocr?:{prepare:()=>Promise<void>;recognize:(image:string)=>Promise<string>};overrides?:Parameters<typeof mockApi>[0]}={}){
  vi.useFakeTimers();vi.setSystemTime(NOW);
  const activity={...await sample(),reserved:false,startsAt:NOW+(options.future??-1000)};
  const api=await mockApi({list:vi.fn(async()=>({activities:[activity],offset:0})),...options.overrides});
  const task=new Reservation(api,vi.fn(),Date.now,options.ocr??ocr());
  await task.open(activity.id);await flush();return{task,api,activity};
}
const ocr=()=>({prepare:vi.fn(async()=>{}),recognize:vi.fn(async()=> '0733')});
it('obtains and recognizes at T-30s, then submits only at the opening deadline',async()=>{
  const{task,api}=await setup({future:60000,ocr:ocr()});task.start();
  await vi.advanceTimersByTimeAsync(29999);expect(api.captcha).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);expect(task.state.code).toBe('0733');expect(task.state.image).toContain('data:image');expect(api.submit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(29999);expect(api.submit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);expect(api.submit).toHaveBeenCalledExactlyOnceWith(task.state.activity!.id,'0733');expect(task.state.phase).toBe('success');
});

it('always uses 30 seconds, including recovery from an old 10-second setting',async()=>{
  const{task,api,activity}=await setup({future:60000,ocr:ocr()});await task.open(activity.id,{leadSeconds:10,verify:false});expect(api.captcha).not.toHaveBeenCalled();task.start();
  await vi.advanceTimersByTimeAsync(29999);expect(api.captcha).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);expect(api.captcha).toHaveBeenCalledTimes(1);task.close();
});
it('uses the server offset for both early acquisition and final submission',async()=>{
  const activity={...await sample(),reserved:false,startsAt:NOW+40000};
  const{task,api}=await setup({ocr:ocr(),overrides:{list:vi.fn(async()=>({activities:[activity],offset:10000}))}});
  task.start();await flush();expect(api.captcha).toHaveBeenCalledTimes(1);expect(api.submit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30000);expect(api.submit).toHaveBeenCalledTimes(1);
});
it('only one captcha and recognition remain in flight across deadline ticks',async()=>{
  const pending=deferred<string>();const{task,api}=await setup({future:10000,ocr:{prepare:async()=>{},recognize:()=>pending.promise}});task.start();await flush();
  await vi.advanceTimersByTimeAsync(9999);expect(api.captcha).toHaveBeenCalledTimes(1);expect(api.submit).not.toHaveBeenCalled();pending.resolve('0733');await flush();
  await vi.advanceTimersByTimeAsync(1);expect(api.submit).toHaveBeenCalledTimes(1);expect(task.state.phase).toBe('success');
});
it('incomplete OCR refreshes immediately before opening and submits only the valid result',async()=>{
  const engine=ocr();engine.recognize.mockResolvedValueOnce('');const{task,api}=await setup({future:10000,ocr:engine});task.start();await flush();
  expect(api.captcha).toHaveBeenCalledTimes(2);expect(task.state.phase).toBe('prepared');expect(api.submit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10000);expect(task.state.phase).toBe('success');
});

it('expired early captcha is replaced immediately after a definitive rejection',async()=>{
  const submit=vi.fn().mockRejectedValueOnce(new ApiError('验证码错误','business')).mockResolvedValue(undefined);
  const{task,api}=await setup({future:10000,ocr:ocr(),overrides:{submit}});task.start();await flush();await vi.advanceTimersByTimeAsync(10000);
  expect(api.captcha).toHaveBeenCalledTimes(2);expect(submit).toHaveBeenCalledTimes(2);expect(task.state.phase).toBe('success');
});
it('repeated OCR failures recover without a fixed delay or retry limit',async()=>{
  const engine=ocr();engine.recognize.mockResolvedValueOnce('').mockRejectedValueOnce(new Error('infer')).mockResolvedValueOnce('12');
  const{task,api}=await setup({ocr:engine});task.start();await flush();expect(api.captcha).toHaveBeenCalledTimes(4);expect(task.state.phase).toBe('success');
});
it.each(['session','rate'] as const)('stops on %s without resubmitting or hiding the error in verification',async kind=>{
  const{task,api}=await setup({ocr:ocr(),overrides:{submit:vi.fn(async()=>{throw new ApiError('stop',kind);})}});task.start();await flush();expect(task.state.phase).toBe(kind==='session'?'login-required':'failed');expect(api.submit).toHaveBeenCalledTimes(1);expect(api.booked).not.toHaveBeenCalled();
});
it('full response is terminal and never starts monitoring',async()=>{
  const{task,api}=await setup({ocr:ocr(),overrides:{submit:vi.fn(async()=>{throw new ApiError('人数已满','business');})}});task.start();await flush();await vi.advanceTimersByTimeAsync(120000);expect(task.state.phase).toBe('failed');expect(api.captcha).toHaveBeenCalledTimes(1);
});
it('captcha retry does not query capacity even if the list changes',async()=>{
  const engine=ocr();engine.recognize.mockResolvedValueOnce('');const{task,api}=await setup({ocr:engine});
  task.start();await flush();expect(task.state.phase).toBe('success');expect(api.list).toHaveBeenCalledTimes(1);expect(api.captcha).toHaveBeenCalledTimes(2);
});
it('failed prewarming retries engine preparation automatically when the task starts',async()=>{
  const engine=ocr();engine.prepare.mockRejectedValueOnce(new Error('assets'));const{task,api}=await setup({future:10000,ocr:engine});expect(task.state.ocrStatus).toBe('failed');
  task.start();await flush();await vi.advanceTimersByTimeAsync(10000);expect(engine.prepare).toHaveBeenCalledTimes(2);expect(task.state.phase).toBe('success');expect(api.submit).toHaveBeenCalledTimes(1);
});
it('persistent engine initialization failure stops with diagnostics, never waiting for manual input',async()=>{
  const engine=ocr();engine.prepare.mockRejectedValue(new Error('assets'));const{task,api}=await setup({ocr:engine});task.start();await flush();
  expect(task.state.phase).toBe('failed');expect(task.state.message).toContain('OCR 引擎准备失败');expect(api.submit).not.toHaveBeenCalled();expect(engine.recognize).not.toHaveBeenCalled();expect(engine.prepare).toHaveBeenCalledTimes(2);
});
it('serializes automatic writes and verifies timeout without resubmitting',async()=>{
  const pending=deferred<void>();const{task,api}=await setup({overrides:{submit:vi.fn(()=>pending.promise)}});task.start();await flush();task.start();
  expect(task.close()).toBe(false);expect(controls(task.state).submit).toBe(false);await vi.advanceTimersByTimeAsync(10000);expect(api.submit).toHaveBeenCalledTimes(1);
  pending.reject(new ApiError('超时','network'));await flush();expect(task.state.phase).toBe('success');expect(api.submit).toHaveBeenCalledTimes(1);
});
it('verification is bounded; unknown outcomes only allow rechecking',async()=>{
  const{task,api}=await setup({overrides:{booked:vi.fn(async()=>false)}});task.start();await flush();await vi.runAllTimersAsync();expect(task.state.phase).toBe('unknown');expect(api.booked).toHaveBeenCalledTimes(3);
  const check=task.verify();void task.verify();await vi.runAllTimersAsync();await check;expect(api.booked).toHaveBeenCalledTimes(6);expect(api.submit).toHaveBeenCalledTimes(1);
});
it('closing cancels the deadline and ignores late OCR',async()=>{
  const pending=deferred<string>();const{task,api}=await setup({future:10000,ocr:{prepare:async()=>{},recognize:()=>pending.promise}});task.start();await flush();task.close();pending.resolve('1234');await vi.advanceTimersByTimeAsync(20000);expect(task.state.phase).toBe('closed');expect(api.submit).not.toHaveBeenCalled();
});
it('network image retries are bounded; closing cancels retry waits',async()=>{
  const{task,api}=await setup({overrides:{captcha:vi.fn(async()=>{throw new ApiError('offline','network');})}});task.start();await vi.runAllTimersAsync();expect(api.captcha).toHaveBeenCalledTimes(3);expect(task.state.phase).toBe('failed');
});
it.each([{reserved:true},{cancelled:true},{endsAt:NOW},{count:5000,capacity:5000,countKnown:true}])('does not start unavailable activities: %j',async variant=>{
  const a={...await sample(),reserved:false,...variant};const{task,api}=await setup({overrides:{list:vi.fn(async()=>({activities:[a],offset:0}))}});task.start();await flush();expect(api.captcha).not.toHaveBeenCalled();expect(api.submit).not.toHaveBeenCalled();
});
it('pending OCR at opening submits once as soon as it finishes',async()=>{
  const pending=deferred<string>();const{task,api}=await setup({future:10000,ocr:{prepare:async()=>{},recognize:()=>pending.promise}});task.start();await flush();await vi.advanceTimersByTimeAsync(10000);expect(api.submit).not.toHaveBeenCalled();pending.resolve('1234');await flush();expect(api.submit).toHaveBeenCalledTimes(1);expect(task.state.phase).toBe('success');
});
it('late CAPTCHA response after closing is ignored',async()=>{
  const pending=deferred<string>();const{task}=await setup({overrides:{captcha:vi.fn(async()=> (await pending.promise)!)}});task.start();task.close();pending.resolve('old-image');await flush();expect(task.state.phase).toBe('closed');expect(task.state.image).toBeUndefined();
});
it('falls back to detail data when the target is absent from the list',async()=>{
  const{task,api}=await setup({overrides:{list:vi.fn(async()=>({activities:[],offset:0}))}});expect(api.detail).toHaveBeenCalledTimes(1);task.start();await flush();expect(api.captcha).toHaveBeenCalledTimes(1);task.close();
});
it('closing during a network retry cancels the remaining attempts',async()=>{
  const{task,api}=await setup({overrides:{captcha:vi.fn(async()=>{throw new ApiError('offline','network');})}});task.start();await flush();task.close();await vi.runAllTimersAsync();expect(api.captcha).toHaveBeenCalledTimes(1);
});
it('not-open rejection refreshes captcha and retries sequentially without polling or delays',async()=>{
  const submit=vi.fn().mockRejectedValueOnce(new ApiError('尚未开放预约','business')).mockResolvedValue(undefined);
  const{task,api}=await setup({ocr:ocr(),overrides:{submit}});task.start();await flush();
  expect(submit).toHaveBeenCalledTimes(2);expect(api.captcha).toHaveBeenCalledTimes(2);expect(api.list).toHaveBeenCalledTimes(1);expect(task.state.phase).toBe('success');
});
it('already-booked feedback goes to verification rather than retrying',async()=>{
  const{task,api}=await setup({ocr:ocr(),overrides:{submit:vi.fn(async()=>{throw new ApiError('已预约该活动','business');})}});task.start();await flush();expect(api.submit).toHaveBeenCalledTimes(1);expect(api.captcha).toHaveBeenCalledTimes(1);expect(api.booked).toHaveBeenCalledTimes(1);expect(task.state.phase).toBe('success');
});
it('business rate or login messages containing captcha do not trigger retries',async()=>{
  for(const msg of ['验证码请求过于频繁','登录失效，无法验证验证码']){
    const{task,api}=await setup({ocr:ocr(),overrides:{submit:vi.fn(async()=>{throw new ApiError(msg,'business');})}});task.start();await flush();expect(task.state.phase).toBe('failed');expect(api.captcha).toHaveBeenCalledTimes(1);expect(api.submit).toHaveBeenCalledTimes(1);
  }
});
it('malformed or gateway-failed writes are verified without repeating the reservation',async()=>{
  for(const kind of ['format','network'] as const){
    const{task,api}=await setup({ocr:ocr(),overrides:{submit:vi.fn(async()=>{throw new ApiError('unknown result',kind,502);})}});task.start();await flush();expect(task.state.phase).toBe('success');expect(api.submit).toHaveBeenCalledTimes(1);expect(api.booked).toHaveBeenCalledTimes(1);
  }
});
it('opening never starts a booking without an explicit start',async()=>{
  const{task,api}=await setup({ocr:ocr()});await vi.advanceTimersByTimeAsync(60000);
  expect(task.state.phase).toBe('ready');expect(api.captcha).not.toHaveBeenCalled();expect(api.submit).not.toHaveBeenCalled();
});
it('unavailable activities do not prepare OCR resources',async()=>{
  for(const variant of [{reserved:true},{cancelled:true},{endsAt:NOW},{count:5000,capacity:5000,countKnown:true}]){
    const engine=ocr(),activity={...await sample(),reserved:false,...variant};
    await setup({ocr:engine,overrides:{list:vi.fn(async()=>({activities:[activity],offset:0}))}});
    expect(engine.prepare).not.toHaveBeenCalled();
  }
});
it('checks the session once per minute but stops before final captcha preparation',async()=>{
  const{task,api}=await setup({future:180000,ocr:ocr()});task.start();
  await vi.advanceTimersByTimeAsync(60000);expect(api.captcha).toHaveBeenCalledTimes(1);expect(task.state.image).toBeUndefined();
  await vi.advanceTimersByTimeAsync(60000);expect(api.captcha).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(30000);expect(api.captcha).toHaveBeenCalledTimes(3);expect(task.state.code).toBe('0733');
  await vi.advanceTimersByTimeAsync(30000);expect(api.captcha).toHaveBeenCalledTimes(3);expect(api.submit).toHaveBeenCalledTimes(1);
});
it('401 retains task identity and can resume after normal login',async()=>{
  const engine=ocr();const{task,api,activity}=await setup({future:180000,ocr:engine});
  vi.mocked(api.captcha).mockRejectedValueOnce(new ApiError('登录失效','session',401));task.start();await vi.advanceTimersByTimeAsync(60000);
  expect(task.state.phase).toBe('login-required');expect(task.state.activity?.id).toBe(activity.id);expect(task.state.code).toBe('');expect(api.submit).not.toHaveBeenCalled();
  await task.resume();expect(task.state.phase).toBe('waiting');await vi.advanceTimersByTimeAsync(120000);expect(task.state.phase).toBe('success');
});
it('an in-flight session probe cannot race the final captcha',async()=>{
  const pending=deferred<string>();const{task,api}=await setup({future:120001,ocr:ocr()});vi.mocked(api.captcha).mockImplementationOnce(()=>pending.promise);task.start();await vi.advanceTimersByTimeAsync(60000);expect(api.captcha).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30002);expect(api.captcha).toHaveBeenCalledTimes(1);
  pending.resolve('probe-image');await flush();expect(api.captcha).toHaveBeenCalledTimes(2);expect(task.state.code).toBe('0733');task.close();
});

it('a session failure during submit resumes by verifying, never repeating the write',async()=>{
  const{task,api}=await setup({ocr:ocr(),overrides:{submit:vi.fn(async()=>{throw new ApiError('登录失效','session',401);})}});
  task.start();await flush();expect(task.state.phase).toBe('login-required');expect(task.state.verifyAfterLogin).toBe(true);
  await task.resume();expect(task.state.phase).toBe('success');expect(api.submit).toHaveBeenCalledTimes(1);expect(api.booked).toHaveBeenCalledTimes(1);
});
it('a session failure during verification preserves verification on login recovery',async()=>{
  const{task,api}=await setup({ocr:ocr()});vi.mocked(api.booked).mockRejectedValueOnce(new ApiError('登录失效','session',401));
  task.start();await flush();expect(task.state.phase).toBe('login-required');expect(task.state.verifyAfterLogin).toBe(true);
  await task.resume();expect(task.state.phase).toBe('success');expect(api.submit).toHaveBeenCalledTimes(1);expect(api.booked).toHaveBeenCalledTimes(2);
});
it('rate limiting during a session check stops further requests',async()=>{
  const{task,api}=await setup({future:180000,overrides:{captcha:vi.fn(async()=>{throw new ApiError('频率限制','rate',429);})}});
  task.start();await vi.advanceTimersByTimeAsync(60000);expect(task.state.phase).toBe('failed');await vi.advanceTimersByTimeAsync(120000);
  expect(api.captcha).toHaveBeenCalledTimes(1);expect(api.submit).not.toHaveBeenCalled();
});

it('starting while prewarming is pending still retries its first initialization failure',async()=>{
  const warmup=deferred<void>(),engine=ocr();engine.prepare.mockImplementationOnce(()=>warmup.promise);
  const{task,api}=await setup({ocr:engine});task.start();await flush();expect(task.state.phase).toBe('recognizing');
  warmup.reject(new Error('temporary initialization failure'));await flush();
  expect(engine.prepare).toHaveBeenCalledTimes(2);expect(task.state.phase).toBe('success');expect(api.submit).toHaveBeenCalledTimes(1);
});
it('two overlapping initialization failures stop after one use-time retry',async()=>{
  const warmup=deferred<void>(),engine=ocr();engine.prepare.mockImplementationOnce(()=>warmup.promise).mockRejectedValue(new Error('unavailable'));
  const{task,api}=await setup({ocr:engine});task.start();await flush();warmup.reject(new Error('unavailable'));await flush();
  expect(engine.prepare).toHaveBeenCalledTimes(2);expect(task.state.phase).toBe('failed');expect(api.submit).not.toHaveBeenCalled();
});
it.each(['captcha','prepare','recognize'] as const)('%s completing after booking closes terminates without retrying or submitting',async stage=>{
  const pending=deferred<string|undefined>(),engine=ocr();if(stage==='prepare')engine.prepare.mockImplementationOnce(async()=>{await pending.promise;});if(stage==='recognize')engine.recognize.mockImplementationOnce(async()=> (await pending.promise)!);
  const activity={...await sample(),reserved:false,startsAt:NOW-1000,endsAt:NOW+100};
  const{task,api}=await setup({ocr:engine,overrides:{list:vi.fn(async()=>({activities:[activity],offset:0})),...(stage==='captcha'?{captcha:vi.fn(async()=> (await pending.promise)!)}:{})}});
  task.start();await flush();await vi.advanceTimersByTimeAsync(101);pending.resolve(stage==='prepare'?undefined:stage==='captcha'?'late-image':'0733');await flush();
  expect(task.state.phase).toBe('failed');expect(task.state.message).toContain('结束');expect(task.state.armed).toBe(false);expect(api.submit).not.toHaveBeenCalled();expect(api.captcha).toHaveBeenCalledTimes(1);
});
