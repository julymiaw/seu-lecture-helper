import {expect,it,vi} from 'vitest';
import {Reservation,controls} from '../src/reservation';
import {ApiError} from '../src/api';
import {mockApi,sample,NOW,deferred} from './helpers';
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
async function setup(options:{future?:number;ocr?:{prepare:()=>Promise<void>;recognize:(image:string)=>Promise<string>};overrides?:Parameters<typeof mockApi>[0]}={}){
  vi.useFakeTimers();vi.setSystemTime(NOW);
  const activity={...await sample(),reserved:false,startsAt:NOW+(options.future??-1000)};
  const api=await mockApi({list:vi.fn(async()=>({activities:[activity],offset:0})),...options.overrides});
  const task=new Reservation(api,vi.fn(),Date.now,()=>true,options.ocr);
  await task.open(activity.id,false);await flush();return{task,api,activity};
}
const ocr=()=>({prepare:vi.fn(async()=>{}),recognize:vi.fn(async()=> '0733')});
it('obtains and recognizes at T-30s, then submits only at the opening deadline',async()=>{
  const{task,api}=await setup({future:60000,ocr:ocr()});task.start();
  await vi.advanceTimersByTimeAsync(29999);expect(api.captcha).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);expect(task.state.code).toBe('0733');expect(task.state.image).toContain('data:image');expect(api.submit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(29999);expect(api.submit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);expect(api.submit).toHaveBeenCalledExactlyOnceWith(task.state.activity!.id,'0733');expect(task.state.phase).toBe('success');
});
it('sends a human correction at the deadline and ignores a late OCR result',async()=>{
  const pending=deferred<string>();const{task,api}=await setup({future:10000,ocr:{prepare:async()=>{},recognize:()=>pending.promise}});
  task.start();await flush();task.editCode('0006');pending.resolve('9999');await flush();expect(task.state.code).toBe('0006');
  await vi.advanceTimersByTimeAsync(10000);expect(api.submit).toHaveBeenCalledWith(task.state.activity!.id,'0006');
});
it('uses the selected lead time, does not take images just by opening, and locks settings after starting',async()=>{
  const{task,api}=await setup({future:60000,ocr:ocr()});task.configure(10);expect(api.captcha).not.toHaveBeenCalled();task.start();task.configure(60);
  await vi.advanceTimersByTimeAsync(49999);expect(api.captcha).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);expect(api.captcha).toHaveBeenCalledTimes(1);task.close();
});
it('uses the server offset for both early acquisition and final submission',async()=>{
  const activity={...await sample(),reserved:false,startsAt:NOW+40000};
  const{task,api}=await setup({ocr:ocr(),overrides:{list:vi.fn(async()=>({activities:[activity],offset:10000}))}});
  task.start();await flush();expect(api.captcha).toHaveBeenCalledTimes(1);expect(api.submit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30000);expect(api.submit).toHaveBeenCalledTimes(1);
});
it('refresh clears the old answer and stale OCR, with one image request in flight',async()=>{
  const old=deferred<string>();const engine=ocr();engine.recognize.mockImplementationOnce(()=>old.promise);
  const{task,api}=await setup({future:10000,ocr:engine});task.start();await flush();
  const image=deferred<string>();vi.mocked(api.captcha).mockImplementationOnce(()=>image.promise);
  const refresh=task.loadCaptcha();void task.loadCaptcha();expect(task.state.code).toBe('');old.resolve('1111');await flush();expect(task.state.code).toBe('');
  image.resolve('new-image');await refresh;await flush();expect(task.state.code).toBe('0733');expect(api.captcha).toHaveBeenCalledTimes(2);task.close();
});
it('a pre-opening OCR failure stays editable without request churn and retries at opening',async()=>{
  const engine=ocr();engine.recognize.mockResolvedValueOnce('');const{task,api}=await setup({future:10000,ocr:engine});task.start();await flush();
  expect(api.captcha).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(9999);expect(api.captcha).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);expect(api.captcha).toHaveBeenCalledTimes(2);expect(task.state.phase).toBe('success');
});
it('a human correction after failed OCR avoids refreshing at opening',async()=>{
  const engine=ocr();engine.recognize.mockResolvedValueOnce('');const{task,api}=await setup({future:10000,ocr:engine});task.start();await flush();task.editCode('1234');
  await vi.advanceTimersByTimeAsync(10000);expect(api.captcha).toHaveBeenCalledTimes(1);expect(api.submit).toHaveBeenCalledWith(task.state.activity!.id,'1234');
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
  const{task,api}=await setup({ocr:ocr(),overrides:{submit:vi.fn(async()=>{throw new ApiError('stop',kind);})}});task.start();await flush();expect(task.state.phase).toBe('failed');expect(api.submit).toHaveBeenCalledTimes(1);expect(api.booked).not.toHaveBeenCalled();
});
it('full response is terminal and never starts monitoring',async()=>{
  const{task,api}=await setup({ocr:ocr(),overrides:{submit:vi.fn(async()=>{throw new ApiError('人数已满','business');})}});task.start();await flush();await vi.advanceTimersByTimeAsync(120000);expect(task.state.phase).toBe('failed');expect(api.captcha).toHaveBeenCalledTimes(1);
});
it('retry stops when the refreshed list is full or unknown',async()=>{
  for(const variant of [{count:5000,capacity:5000,countKnown:true},{countKnown:false}]){
    const engine=ocr();engine.recognize.mockResolvedValue('');const{task,api,activity}=await setup({ocr:engine});
    vi.mocked(api.list).mockResolvedValue({activities:[{...activity,...variant}],offset:0});task.start();await flush();expect(task.state.phase).toBe('failed');expect(api.captcha).toHaveBeenCalledTimes(1);expect(api.submit).not.toHaveBeenCalled();
  }
});
it('model preparation failure permits manual correction and timed submission',async()=>{
  const{task,api}=await setup({future:10000,ocr:{prepare:async()=>{throw new Error('assets');},recognize:vi.fn()}});task.start();await flush();expect(task.state.ocrStatus).toBe('failed');task.editCode('0654');await vi.advanceTimersByTimeAsync(10000);expect(api.submit).toHaveBeenCalledWith(task.state.activity!.id,'0654');
});
it('never submits empty input at opening and permits later manual submit',async()=>{
  const{task,api}=await setup({future:10000});task.start();await flush();await vi.advanceTimersByTimeAsync(10000);expect(api.submit).not.toHaveBeenCalled();task.editCode('1234');await task.submit('1234');expect(task.state.phase).toBe('success');
});
it('serializes writes and verifies timeout without resubmitting',async()=>{
  const pending=deferred<void>();const{task,api}=await setup({overrides:{submit:vi.fn(()=>pending.promise)}});task.start();await flush();task.editCode('1234');const write=task.submit('1234');void task.submit('1234');expect(task.close()).toBe(false);expect(controls(task.state).refresh).toBe(false);pending.reject(new ApiError('超时','network'));await write;expect(task.state.phase).toBe('success');expect(api.submit).toHaveBeenCalledTimes(1);
});
it('verification is bounded; unknown outcomes only allow rechecking',async()=>{
  const{task,api}=await setup({overrides:{booked:vi.fn(async()=>false)}});task.start();await flush();task.editCode('1234');const write=task.submit('1234');await vi.runAllTimersAsync();await write;expect(task.state.phase).toBe('unknown');expect(api.booked).toHaveBeenCalledTimes(3);
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
  const pending=deferred<string>();const{task}=await setup({overrides:{captcha:vi.fn(()=>pending.promise)}});task.start();task.close();pending.resolve('old-image');await flush();expect(task.state.phase).toBe('closed');expect(task.state.image).toBeUndefined();
});
it('falls back to detail data when the target is absent from the list',async()=>{
  const{task,api}=await setup({overrides:{list:vi.fn(async()=>({activities:[],offset:0}))}});expect(api.detail).toHaveBeenCalledTimes(1);task.start();await flush();expect(api.captcha).toHaveBeenCalledTimes(1);task.close();
});
it('stops before requests when cross-tab ownership is lost',async()=>{
  const api=await mockApi();const task=new Reservation(api,vi.fn(),()=>NOW,()=>false);await task.open((await sample()).id);expect(task.state.phase).toBe('failed');expect(api.captcha).not.toHaveBeenCalled();
});
it('closing during a network retry cancels the remaining attempts',async()=>{
  const{task,api}=await setup({overrides:{captcha:vi.fn(async()=>{throw new ApiError('offline','network');})}});task.start();await flush();task.close();await vi.runAllTimersAsync();expect(api.captcha).toHaveBeenCalledTimes(1);
});
