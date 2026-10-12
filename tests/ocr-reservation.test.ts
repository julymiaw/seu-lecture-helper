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
  it('falls back on incomplete recognition or resource failure with the same image available',async()=>{
    for(const failure of ['incomplete','load']) {
      const api=await mockApi(),ocr=engine();
      if(failure==='incomplete') ocr.recognize.mockResolvedValue('123');
      else {ocr.prepare.mockRejectedValue(new Error('download failed')); ocr.recognize.mockRejectedValue(new Error('download failed'));}
      const task=new Reservation(api,vi.fn(),()=>NOW,()=>true,ocr,'ocr'); await task.open((await sample()).id); await settle();
      expect(api.submit).not.toHaveBeenCalled(); expect(task.state.mode).toBe('manual'); expect(task.state.phase).toBe('input'); expect(task.state.image).toBeTruthy();
    }
  });
  it('does not loop automatic submissions after a captcha rejection',async()=>{
    const api=await mockApi({submit:vi.fn(async()=>{throw new ApiError('验证码错误','business');})}); const ocr=engine();
    const task=new Reservation(api,vi.fn(),()=>NOW,()=>true,ocr,'ocr'); await task.open((await sample()).id); await settle();
    expect(api.submit).toHaveBeenCalledOnce(); expect(api.captcha).toHaveBeenCalledTimes(2); expect(task.state.mode).toBe('manual'); expect(task.state.phase).toBe('input');
    task.setMode('ocr'); await settle(); expect(api.submit).toHaveBeenCalledTimes(2); expect(task.state.mode).toBe('manual');
  });
});
