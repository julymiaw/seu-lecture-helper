import {describe, expect, it, vi} from 'vitest';
import {Reservation} from '../src/reservation';
import {ApiError} from '../src/api';
import {deferred, mockApi, NOW, sample} from './helpers';
const settle=async()=>{for(let i=0;i<20;i++) await Promise.resolve();};
const engine=()=>({prepare:vi.fn(async()=>{}),recognize:vi.fn(async()=> '3253')});
describe('OCR reservation lifecycle',()=>{
  it('prepares during countdown without fetching a challenge early; mode is adjustable',async()=>{
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const activity={...await sample(),reserved:false,startsAt:NOW+5000};
    const api=await mockApi({list:vi.fn(async()=>({activities:[activity],offset:0}))}); const ocr=engine();
    const task=new Reservation(api,vi.fn(),Date.now,()=>true,ocr,'ocr'); await task.open(activity.id); await settle();
    expect(ocr.prepare).toHaveBeenCalledOnce(); expect(task.state.ocrStatus).toBe('ready'); expect(api.captcha).not.toHaveBeenCalled();
    task.setMode('manual'); await vi.advanceTimersByTimeAsync(5000); await settle();
    expect(task.state.phase).toBe('input'); expect(ocr.recognize).not.toHaveBeenCalled(); expect(api.submit).not.toHaveBeenCalled();
    task.setMode('ocr'); await settle(); expect(api.submit).toHaveBeenCalledExactlyOnceWith(activity.id,'3253'); expect(task.state.phase).toBe('success');
  });
  it('keeps manual mode free of OCR work',async()=>{
    const api=await mockApi(),ocr=engine(),task=new Reservation(api,vi.fn(),()=>NOW,()=>true,ocr,'manual');
    await task.open((await sample()).id); await settle(); expect(ocr.prepare).not.toHaveBeenCalled(); expect(ocr.recognize).not.toHaveBeenCalled();
    expect(task.state.phase).toBe('input'); expect(api.submit).not.toHaveBeenCalled();
  });
  it('automatically submits once and verifies the booking',async()=>{
    const api=await mockApi(),ocr=engine(),task=new Reservation(api,vi.fn(),()=>NOW,()=>true,ocr,'ocr');
    await task.open((await sample()).id); await settle();
    expect(api.submit).toHaveBeenCalledExactlyOnceWith((await sample()).id,'3253'); expect(api.booked).toHaveBeenCalledOnce(); expect(task.state.phase).toBe('success');
  });
  it('ignores recognition completed after a switch to manual or close',async()=>{
    for(const action of ['manual','close']) {
      const pending=deferred<string>(),api=await mockApi(),ocr={...engine(),recognize:vi.fn(()=>pending.promise)};
      const task=new Reservation(api,vi.fn(),()=>NOW,()=>true,ocr,'ocr'); await task.open((await sample()).id); await settle(); expect(task.state.phase).toBe('recognizing');
      if(action==='manual') task.setMode('manual'); else task.close();
      pending.resolve('3253'); await settle(); expect(api.submit).not.toHaveBeenCalled(); expect(task.state.phase).toBe(action==='manual'?'input':'closed');
    }
  });
  it('ignores the old recognition when the challenge is refreshed',async()=>{
    const first=deferred<string>(),second=deferred<string>(),api=await mockApi();
    const ocr={...engine(),recognize:vi.fn().mockImplementationOnce(()=>first.promise).mockImplementationOnce(()=>second.promise)};
    const task=new Reservation(api,vi.fn(),()=>NOW,()=>true,ocr,'ocr'); await task.open((await sample()).id); await settle();
    await task.loadCaptcha(); first.resolve('1111'); await settle(); expect(api.submit).not.toHaveBeenCalled();
    second.resolve('3253'); await settle(); expect(api.submit).toHaveBeenCalledExactlyOnceWith((await sample()).id,'3253');
  });
  it('stops replacement when the latest list confirms full capacity',async()=>{
    const base=await mockApi(),item=(await base.list()).activities[0];
    const api={...base,list:vi.fn().mockResolvedValueOnce({activities:[item],offset:0}).mockResolvedValueOnce({activities:[item],offset:0}).mockResolvedValue({activities:[{...item,count:item.capacity,countKnown:true}],offset:0})};
    const ocr=engine();ocr.recognize.mockResolvedValue('123');
    const task=new Reservation(api,vi.fn(),()=>NOW,()=>true,ocr,'ocr');await task.open(item.id);await settle();await settle();
    expect(task.state).toMatchObject({phase:'ready',taskMode:'monitor',full:true});expect(api.captcha).toHaveBeenCalledTimes(2);expect(api.submit).not.toHaveBeenCalled();task.close();
  });
  it('can recover after more than three failures without timer delays',async()=>{
    const api=await mockApi(),ocr=engine();ocr.recognize.mockResolvedValueOnce('123').mockResolvedValueOnce('123').mockResolvedValueOnce('123').mockResolvedValueOnce('123');
    const task=new Reservation(api,vi.fn(),()=>NOW,()=>true,ocr,'ocr');await task.open((await sample()).id);
    for(let i=0;i<8;i++)await settle();
    expect(task.state.phase).toBe('success');expect(api.captcha).toHaveBeenCalledTimes(5);expect(api.submit).toHaveBeenCalledTimes(1);task.close();
  });
  it.each(['incomplete','throw','captcha'])('recovers automatically from a transient %s error with a new image',async failure=>{
    vi.useFakeTimers();vi.setSystemTime(NOW);const api=await mockApi(),ocr=engine();
    if(failure==='incomplete')ocr.recognize.mockResolvedValueOnce('123');
    if(failure==='throw')ocr.recognize.mockRejectedValueOnce(new Error('decode'));
    if(failure==='captcha')vi.mocked(api.submit).mockRejectedValueOnce(new ApiError('验证码错误','business'));
    const task=new Reservation(api,vi.fn(),Date.now,()=>true,ocr,'ocr');await task.open((await sample()).id);await settle();
    expect(task.state.mode).toBe('ocr');
    await settle();await settle();expect(task.state.phase).toBe('success');
    expect(api.captcha).toHaveBeenCalledTimes(2);expect(api.submit).toHaveBeenCalledTimes(failure==='captcha'?2:1);task.close();
  });
  it.each(['rate','network','session','format'] as const)('stops retry on a %s capacity-query error',async kind=>{
    const base=await mockApi(),item=(await base.list()).activities[0];
    const api={...base,list:vi.fn().mockResolvedValueOnce({activities:[item],offset:0}).mockRejectedValue(new ApiError('blocked',kind))};
    const ocr=engine();ocr.recognize.mockResolvedValue('123');const task=new Reservation(api,vi.fn(),()=>NOW,()=>true,ocr,'ocr');await task.open(item.id);await settle();
    expect(task.state.phase).toBe('failed');expect(api.captcha).toHaveBeenCalledTimes(1);expect(api.submit).not.toHaveBeenCalled();task.close();
  });
  it('drops a retry query that completes after closing',async()=>{
    const base=await mockApi(),item=(await base.list()).activities[0],pending=deferred<{activities:typeof item[];offset:number}>();
    const api={...base,list:vi.fn().mockResolvedValueOnce({activities:[item],offset:0}).mockImplementationOnce(()=>pending.promise)};
    const ocr=engine();ocr.recognize.mockResolvedValue('123');const task=new Reservation(api,vi.fn(),()=>NOW,()=>true,ocr,'ocr');await task.open(item.id);await settle();task.close();
    pending.resolve({activities:[item],offset:0});await settle();expect(api.captcha).toHaveBeenCalledTimes(1);expect(task.state.phase).toBe('closed');
  });
});
