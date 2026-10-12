import {describe, expect, it, vi} from 'vitest';
import {ApiError} from '../src/api';
import {Reservation} from '../src/reservation';
import {deferred, mockApi, NOW, sample} from './helpers';
const flush = async () => {await Promise.resolve(); await Promise.resolve();};
describe('reservation lifecycle', () => {
  it('takes one captcha at the deadline using the server clock offset', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const a = {...await sample(),reserved:false, startsAt:NOW+5000};
    const api = await mockApi({list:vi.fn(async()=>({activities:[a],offset:1000}))});
    const task = new Reservation(api,vi.fn()); await task.open(a.id);
    expect(task.state.phase).toBe('waiting'); expect(api.captcha).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3999); expect(api.captcha).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(api.captcha).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10000); expect(api.captcha).toHaveBeenCalledTimes(1);
  });
  it('does not take a captcha for a booked, cancelled or ended event', async () => {
    for (const variant of [{reserved:true},{cancelled:true},{endsAt:NOW}]) {
      const a={...await sample(),reserved:false,...variant}; const api=await mockApi({list:vi.fn(async()=>({activities:[a],offset:0}))});
      const task=new Reservation(api,vi.fn(),()=>NOW); await task.open(a.id);
      expect(api.captcha).not.toHaveBeenCalled(); expect(task.state.phase).toBe(variant.reserved?'success':'failed');
    }
  });
  it('uses detail when target is not listed', async () => {
    const api=await mockApi({list:vi.fn(async()=>({activities:[],offset:0}))}); const task=new Reservation(api,vi.fn(),()=>NOW);
    await task.open('id'); await flush(); expect(api.detail).toHaveBeenCalledWith('id'); expect(api.captcha).toHaveBeenCalledTimes(1);
  });
  it('ignores late responses after closing or switching generation', async () => {
    const pending=deferred<string>(); const api=await mockApi({captcha:vi.fn(()=>pending.promise)});
    const task=new Reservation(api,vi.fn(),()=>NOW); await task.open('9077433c420649399417b52eae7d5b50');
    expect(task.close()).toBe(true); pending.resolve('old'); await flush(); expect(task.state.phase).toBe('closed');
  });
  it('locks submission synchronously and verifies success', async () => {
    const pending=deferred<void>(); const api=await mockApi({submit:vi.fn(()=>pending.promise)});
    const task=new Reservation(api,vi.fn(),()=>NOW); await task.open((await sample()).id); await flush();
    const first=task.submit('1234'); await task.submit('1234'); expect(api.submit).toHaveBeenCalledTimes(1);
    expect(task.close()).toBe(false); pending.resolve(); await first; expect(task.state.phase).toBe('success');
    expect(api.booked).toHaveBeenCalledTimes(1);
    expect(task.state.activity?.reserved).toBe(true);
  });
  it('rejects blank or too-long input without sending', async () => {
    const api=await mockApi(); const task=new Reservation(api,vi.fn(),()=>NOW); await task.open((await sample()).id); await flush();
    await task.submit(''); await task.submit('12345'); expect(api.submit).not.toHaveBeenCalled(); expect(task.state.phase).toBe('input');
  });
  it('refreshes on captcha business error but never resubmits automatically', async () => {
    const api=await mockApi({submit:vi.fn(async()=>{throw new ApiError('验证码错误，请重试','business');})});
    const task=new Reservation(api,vi.fn(),()=>NOW); await task.open((await sample()).id); await flush();
    await task.submit('no'); expect(api.submit).toHaveBeenCalledTimes(1); expect(api.captcha).toHaveBeenCalledTimes(2); expect(task.state.phase).toBe('input'); expect(task.state.message).toContain('验证码错误');
  });
  it('stops on other business errors', async () => {
    const api=await mockApi({submit:vi.fn(async()=>{throw new ApiError('资格不符合','business');})});
    const task=new Reservation(api,vi.fn(),()=>NOW); await task.open((await sample()).id); await flush(); await task.submit('1234');
    expect(task.state.phase).toBe('failed'); expect(api.booked).not.toHaveBeenCalled(); expect(api.captcha).toHaveBeenCalledTimes(1);
  });
  it('verifies a timed-out write and recognizes it as successful', async () => {
    const api=await mockApi({submit:vi.fn(async()=>{throw new ApiError('超时','network');})});
    const task=new Reservation(api,vi.fn(),()=>NOW); await task.open((await sample()).id); await flush(); await task.submit('1234');
    expect(task.state.phase).toBe('success'); expect(api.submit).toHaveBeenCalledTimes(1);
  });
  it('bounds verification, leaves unknown state and only rechecks manually', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW); const api=await mockApi({booked:vi.fn(async()=>false)});
    const task=new Reservation(api,vi.fn()); await task.open((await sample()).id); await flush(); const submit=task.submit('1234');
    await vi.runAllTimersAsync(); await submit;
    expect(task.state.phase).toBe('unknown'); expect(api.booked).toHaveBeenCalledTimes(3); expect(api.submit).toHaveBeenCalledTimes(1);
    const recheck=task.verify(); await vi.runAllTimersAsync(); await recheck; expect(api.submit).toHaveBeenCalledTimes(1); expect(api.booked).toHaveBeenCalledTimes(6);
  });
  it('recognizes delayed booking visibility', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW); const api=await mockApi({booked:vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)});
    const task=new Reservation(api,vi.fn()); await task.open((await sample()).id); await flush(); const submit=task.submit('1234'); await vi.runAllTimersAsync(); await submit;
    expect(task.state.phase).toBe('success'); expect(api.booked).toHaveBeenCalledTimes(2);
  });
  it('bounds captcha network retry and stops immediately on rate limits', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW); const api=await mockApi({captcha:vi.fn(async()=>{throw new ApiError('offline','network');})});
    const task=new Reservation(api,vi.fn()); await task.open((await sample()).id); await vi.runAllTimersAsync();
    expect(api.captcha).toHaveBeenCalledTimes(3); expect(task.state.phase).toBe('failed');
    const limited=await mockApi({captcha:vi.fn(async()=>{throw new ApiError('limit','rate');})}); const other=new Reservation(limited,vi.fn());
    await other.open((await sample()).id); await vi.runAllTimersAsync(); expect(limited.captcha).toHaveBeenCalledTimes(1);
  });
  it('cancels waiting retries and drops stale captcha refresh results', async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW); const api=await mockApi({captcha:vi.fn(async()=>{throw new ApiError('offline','network');})});
    const task=new Reservation(api,vi.fn()); await task.open((await sample()).id); await flush(); task.close(); await vi.runAllTimersAsync();
    expect(api.captcha).toHaveBeenCalledTimes(1); expect(task.state.phase).toBe('closed');
  });
  it('stops before taking a captcha when task ownership is lost', async () => {
    const api=await mockApi(); const task=new Reservation(api,vi.fn(),()=>NOW,()=>false); await task.open((await sample()).id); await flush();
    expect(api.captcha).not.toHaveBeenCalled(); expect(task.state.phase).toBe('failed');
  });
});
