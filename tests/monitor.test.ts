import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ApiError, type Activity} from '../src/api';
import {controls, Reservation} from '../src/reservation';
import {deferred, mockApi, NOW, sample} from './helpers';
const flush = async () => {for (let i=0;i<12;i++) await Promise.resolve();};
async function setup(overrides: Partial<Activity> = {}) {
  const item: Activity = {...await sample(), reserved:false, capacity:150, count:150, countKnown:true, startsAt:NOW-1000, endsAt:NOW+3600000, ...overrides};
  const base = await mockApi();
  const api = {...base, list:vi.fn(async()=>({activities:[{...item}],offset:0})), submit:vi.fn(base.submit), booked:vi.fn(base.booked)};
  const publish=vi.fn();
  const task=new Reservation(api,publish,Date.now,()=>true,undefined,'manual',()=>0.5);
  await task.open(item.id,false);
  return {item,api,task,publish};
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(NOW);});
describe('low frequency seat monitoring',()=>{
  it('selects monitoring when full, but requires explicit start and uses one query per interval',async()=>{
    const {task,api}=await setup();
    expect(task.state).toMatchObject({phase:'ready',taskMode:'monitor',interval:60});
    await vi.advanceTimersByTimeAsync(120000);expect(api.list).toHaveBeenCalledTimes(1);expect(api.captcha).not.toHaveBeenCalled();
    task.start();await flush();expect(api.list).toHaveBeenCalledTimes(2);expect(task.state.phase).toBe('monitoring');
    await vi.advanceTimersByTimeAsync(59999);expect(api.list).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);expect(api.list).toHaveBeenCalledTimes(3);expect(api.captcha).not.toHaveBeenCalled();task.close();
  });
  it('uses the next list snapshot directly to acquire one challenge and stops polling during input and after success',async()=>{
    const {task,api,item}=await setup();task.start();await flush();item.count=149;
    await vi.advanceTimersByTimeAsync(60000);expect(api.captcha).toHaveBeenCalledTimes(1);expect(task.state.phase).toBe('input');
    const queries=api.list.mock.calls.length;await vi.advanceTimersByTimeAsync(180000);expect(api.list).toHaveBeenCalledTimes(queries);
    await task.submit('1234');expect(task.state.phase).toBe('success');await vi.advanceTimersByTimeAsync(180000);
    expect(api.submit).toHaveBeenCalledTimes(1);expect(api.list).toHaveBeenCalledTimes(queries);task.close();
  });
  it.each([{countKnown:false},{count:NaN},{count:-1},{count:151},{capacity:0}])('does not trigger for missing or inconsistent counts %j',async variant=>{
    const {task,api}=await setup(variant);task.configure({taskMode:'monitor'});task.start();await flush();
    await vi.advanceTimersByTimeAsync(60000);expect(api.captcha).not.toHaveBeenCalled();expect(task.state.message).toContain('人数数据');task.close();
  });
  it.each([{reserved:true},{cancelled:true},{endsAt:NOW+30000}])('terminates on booking, cancellation or expiry %j',async variant=>{
    const {task,api,item}=await setup();task.start();await flush();Object.assign(item,variant);
    await vi.advanceTimersByTimeAsync(60000);
    expect(task.state.phase).toBe(variant.reserved?'success':'failed');expect(api.captcha).not.toHaveBeenCalled();
    const queries=api.list.mock.calls.length;await vi.advanceTimersByTimeAsync(180000);expect(api.list).toHaveBeenCalledTimes(queries);task.close();
  });
  it('does not poll unopened activities until the opening time',async()=>{
    const {task,api}=await setup({count:149,startsAt:NOW+3600000,endsAt:NOW+7200000});expect(task.state.taskMode).toBe('scheduled');
    task.configure({taskMode:'monitor'});task.start();await flush();
    await vi.advanceTimersByTimeAsync(3599999);expect(api.list).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);expect(api.list).toHaveBeenCalledTimes(3);task.close();
  });
  it('pauses, resumes and changes interval without duplicating loops',async()=>{
    const {task,api}=await setup();task.start();await flush();task.pause();await vi.advanceTimersByTimeAsync(120000);
    expect(api.list).toHaveBeenCalledTimes(2);expect(task.state.phase).toBe('paused');task.configure({interval:30});task.start();await flush();
    expect(api.list).toHaveBeenCalledTimes(3);await vi.advanceTimersByTimeAsync(30000);expect(api.list).toHaveBeenCalledTimes(4);task.close();
  });
  it('changing the interval keeps the current deadline and applies after the next query',async()=>{
    const {task,api}=await setup();task.start();await flush();
    await vi.advanceTimersByTimeAsync(50000);const deadline=task.state.nextCheck;
    task.configure({interval:30});expect(task.state.nextCheck).toBe(deadline);expect(task.state.remaining).toBe(10000);
    await vi.advanceTimersByTimeAsync(9999);expect(api.list).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);expect(api.list).toHaveBeenCalledTimes(3);expect(task.state.nextCheck).toBe(NOW+90000);
    await vi.advanceTimersByTimeAsync(30000);expect(api.list).toHaveBeenCalledTimes(4);task.close();
  });
  it('checking now resets the deadline, has no cooldown, and cancels the old timer',async()=>{
    const {task,api}=await setup();task.start();await flush();await vi.advanceTimersByTimeAsync(20000);
    task.configure({interval:120});task.checkNow();await flush();expect(api.list).toHaveBeenCalledTimes(3);
    expect(task.state.nextCheck).toBe(NOW+140000);
    task.checkNow();await flush();expect(api.list).toHaveBeenCalledTimes(4); // No arbitrary cooldown.
    await vi.advanceTimersByTimeAsync(40000);expect(api.list).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(80000);expect(api.list).toHaveBeenCalledTimes(5);task.close();
  });
  it('manual checks and interval changes do not overlap an in-flight query',async()=>{
    const {task,api,item}=await setup();task.start();await flush();const pending=deferred<{activities:Activity[];offset:number}>();
    api.list.mockImplementationOnce(()=>pending.promise);task.checkNow();task.checkNow();
    expect(controls(task.state).checkNow).toBe(false);task.configure({interval:30});
    await vi.advanceTimersByTimeAsync(90000);expect(api.list).toHaveBeenCalledTimes(3);
    pending.resolve({activities:[item],offset:0});await flush();expect(task.state.nextCheck).toBe(Date.now()+30000);
    expect(controls(task.state).checkNow).toBe(true);await vi.advanceTimersByTimeAsync(30000);expect(api.list).toHaveBeenCalledTimes(4);task.close();
  });
  it('a manual click at an automatic deadline shares the same single in-flight request',async()=>{
    const {task,api,item}=await setup();task.start();await flush();const pending=deferred<{activities:Activity[];offset:number}>();
    api.list.mockImplementationOnce(()=>pending.promise);await vi.advanceTimersByTimeAsync(60000);task.checkNow();
    expect(api.list).toHaveBeenCalledTimes(3);pending.resolve({activities:[item],offset:0});await flush();
    expect(vi.getTimerCount()).toBe(1);task.close();
  });
  it('checking now finds a vacancy using the same booking path and stops polling during input',async()=>{
    const {task,api,item}=await setup();task.start();await flush();item.count=149;task.checkNow();await flush();
    expect(task.state.phase).toBe('input');expect(api.captcha).toHaveBeenCalledTimes(1);expect(controls(task.state).checkNow).toBe(false);
    task.checkNow();await vi.advanceTimersByTimeAsync(120000);expect(api.list).toHaveBeenCalledTimes(3);task.close();
  });
  it('interval changes and checking now cannot skip the opening time or network backoff',async()=>{
    const future=await setup({startsAt:NOW+60000});future.task.start();await flush();
    future.task.configure({interval:30});future.task.checkNow();expect(future.task.state.nextCheck).toBe(NOW+60000);
    expect(future.api.list).toHaveBeenCalledTimes(2);future.task.close();
    const {task,api}=await setup();api.list.mockRejectedValueOnce(new ApiError('offline','network'));task.start();await flush();
    const deadline=task.state.nextCheck;task.configure({interval:30});task.checkNow();
    expect(task.state.nextCheck).toBe(deadline);expect(api.list).toHaveBeenCalledTimes(2);expect(controls(task.state).checkNow).toBe(false);
    await vi.advanceTimersByTimeAsync(120000);expect(api.list).toHaveBeenCalledTimes(3);expect(task.state.nextCheck).toBe(Date.now()+30000);task.close();
  });
  it('never overlaps a slow query even if paused and resumed before it settles',async()=>{
    const {task,api,item}=await setup();const pending=deferred<{activities:Activity[];offset:number}>();
    api.list.mockImplementationOnce(()=>pending.promise);task.start();await flush();
    await vi.advanceTimersByTimeAsync(300000);expect(api.list).toHaveBeenCalledTimes(2);
    task.pause();task.start();await flush();expect(api.list).toHaveBeenCalledTimes(2);
    pending.resolve({activities:[item],offset:0});await flush();expect(api.list).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60000);expect(api.list).toHaveBeenCalledTimes(4);task.close();
  });
  it('ignores a response that arrives after stopping',async()=>{
    const {task,api,item}=await setup();const pending=deferred<{activities:Activity[];offset:number}>();api.list.mockImplementationOnce(()=>pending.promise);
    task.start();await flush();task.close();pending.resolve({activities:[{...item,count:149}],offset:0});await flush();
    expect(task.state.phase).toBe('closed');expect(api.captcha).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });
  it('backs off 2/4/8/8 minutes on network failure and pauses at the fifth failure',async()=>{
    const {task,api}=await setup();api.list.mockRejectedValue(new ApiError('offline','network'));task.start();await flush();
    for(const minutes of [2,4,8,8]) {expect(task.state.nextCheck!-Date.now()).toBe(minutes*60000);await vi.advanceTimersByTimeAsync(minutes*60000);}
    expect(api.list).toHaveBeenCalledTimes(6);expect(task.state.phase).toBe('paused');expect(vi.getTimerCount()).toBe(0);task.close();
  });
  it.each(['session','rate','format','business'] as const)('pauses immediately for %s, without fetching a challenge',async kind=>{
    const {task,api}=await setup();api.list.mockRejectedValue(new ApiError('停止原因',kind));task.start();await flush();
    expect(task.state).toMatchObject({phase:'paused',message:'停止原因'});expect(api.captcha).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);task.close();
  });
  it('pauses if the target disappears instead of fetching another activity',async()=>{
    const {task,api}=await setup();api.list.mockResolvedValue({activities:[],offset:0});task.start();await flush();
    expect(task.state.phase).toBe('paused');expect(api.detail).not.toHaveBeenCalled();expect(api.captcha).not.toHaveBeenCalled();task.close();
  });
  it('returns to the polling interval on an explicit full-capacity rejection, without immediate retry',async()=>{
    const {task,api}=await setup({count:149});task.configure({taskMode:'monitor'});task.start();await flush();
    api.submit.mockRejectedValue(new ApiError('人数已满','business'));await task.submit('1234');expect(task.state.phase).toBe('monitoring');
    expect(api.submit).toHaveBeenCalledTimes(1);expect(api.captcha).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59999);expect(api.captcha).toHaveBeenCalledTimes(1);task.close();
  });
  it('scheduled follow-up is opt-in and only transitions for an explicit full-capacity response',async()=>{
    const {task,api}=await setup({count:149});task.configure({followUp:true});task.start();await flush();
    api.submit.mockRejectedValue(new ApiError('人数已满','business'));await task.submit('1234');expect(task.state).toMatchObject({phase:'monitoring',taskMode:'monitor'});task.close();
    const other=await setup({count:149});other.task.configure({followUp:true});other.task.start();await flush();
    other.api.submit.mockRejectedValue(new ApiError('未知业务错误','business'));await other.task.submit('1234');expect(other.task.state.phase).toBe('failed');other.task.close();
  });
  it('does not turn a result-unknown write into monitoring or resubmission',async()=>{
    const {task,api}=await setup({count:149});task.configure({taskMode:'monitor'});task.start();await flush();
    api.submit.mockRejectedValue(new ApiError('timeout','network'));api.booked.mockResolvedValue(false);
    const submit=task.submit('1234');await vi.advanceTimersByTimeAsync(3000);await submit;
    expect(task.state.phase).toBe('unknown');await vi.advanceTimersByTimeAsync(180000);expect(api.submit).toHaveBeenCalledTimes(1);expect(api.list).toHaveBeenCalledTimes(2);task.close();
  });
  it('checks once after a long suspension without catching up missed polls',async()=>{
    const {task,api}=await setup();task.start();await flush();vi.setSystemTime(NOW+600000);
    await vi.advanceTimersByTimeAsync(1000);expect(api.list).toHaveBeenCalledTimes(3);await flush();expect(api.list).toHaveBeenCalledTimes(3);task.close();
  });
});
