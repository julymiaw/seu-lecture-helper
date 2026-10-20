import {expect,it,vi} from 'vitest';
import {MAX_CLOCK_RTT_MS} from '../src/clock';
import {Reservation} from '../src/reservation';
import {NOW,sample,mockApi,deferred} from './helpers';
const flush=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
async function setup() {
  vi.useFakeTimers();vi.setSystemTime(NOW);
  const remote=(offset=0,rttMs=0)=>({serverTime:Date.now()+offset-rttMs/2,receivedAt:Date.now(),rttMs,offset});
  const activity={...await sample(),reserved:false,startsAt:NOW+60000,endsAt:NOW+120000};
  const api=await mockApi({list:vi.fn(async()=>({activities:[activity],clock:remote()})),detail:vi.fn(async()=>({activity,clock:remote()}))});
  const task=new Reservation(api,vi.fn(),Date.now,{prepare:async()=>{},recognize:async()=> '0733'});
  await task.open(activity.id);await flush();return {task,api,activity,remote};
}
it('final clock correction moves capture and submission together, without submitting before estimated server opening',async()=>{
  const {task,api,activity,remote}=await setup();vi.mocked(api.detail).mockImplementation(async()=>({activity,clock:remote(5000)}));task.start();
  await vi.advanceTimersByTimeAsync(20000);expect(task.state.clock?.offset).toBe(5000);
  await vi.advanceTimersByTimeAsync(4999);expect(api.captcha).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);expect(api.captcha).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(29999);expect(api.submit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);expect(api.submit).toHaveBeenCalledTimes(1);
});
it('rejects a slow calibration sample and retains the previous clock',async()=>{
  const {task,api,activity,remote}=await setup(),previous=task.state.clock;
  vi.mocked(api.detail).mockImplementation(async()=>({activity,clock:remote(60000,MAX_CLOCK_RTT_MS+1)}));task.start();
  await vi.advanceTimersByTimeAsync(20000);expect(task.state.clock).toEqual(previous);
  expect(vi.mocked(console.warn).mock.calls.some(call=>call[1]?.event==='服务器校时'&&call[1]?.accepted===false)).toBe(true);
  await vi.advanceTimersByTimeAsync(40000);expect(task.state.phase).toBe('success');
});
it('failed final calibration keeps the old clock and still submits at its deadline',async()=>{
  const {task,api}=await setup(),previous=task.state.clock;vi.mocked(api.detail).mockRejectedValue(new Error('offline'));task.start();
  await vi.advanceTimersByTimeAsync(20000);expect(task.state.clock).toEqual(previous);expect(task.state.phase).toBe('waiting');
  await vi.advanceTimersByTimeAsync(40000);expect(api.submit).toHaveBeenCalledTimes(1);
});
it('late heartbeat errors after captcha preparation cannot pause or replace the task',async()=>{
  const {ApiError}=await import('../src/api'),{task,api}=await setup();
  const pending=deferred<Awaited<ReturnType<typeof api.detail>>>();vi.mocked(api.detail).mockImplementationOnce(()=>pending.promise);task.start();
  await vi.advanceTimersByTimeAsync(30000);expect(task.state.phase).toBe('prepared');
  pending.reject(new ApiError('登录失效','session',401));await flush();expect(task.state.phase).toBe('prepared');
  await vi.advanceTimersByTimeAsync(30000);expect(task.state.phase).toBe('success');
});
it('closing invalidates an outstanding calibration request',async()=>{
  const {task,api,activity,remote}=await setup(),pending=deferred<Awaited<ReturnType<typeof api.detail>>>();
  vi.mocked(api.detail).mockImplementationOnce(()=>pending.promise);task.start();await vi.advanceTimersByTimeAsync(20000);task.close();
  pending.resolve({activity,clock:remote(60000)});await flush();await vi.advanceTimersByTimeAsync(60000);
  expect(task.state.phase).toBe('closed');expect(api.captcha).not.toHaveBeenCalled();expect(api.submit).not.toHaveBeenCalled();
});
it.each([false,true])('stale detail fallback cannot overwrite the clock after close; replacement=%s',async replacement=>{
  const {task,api,activity,remote}=await setup(),pending=deferred<Awaited<ReturnType<typeof api.detail>>>();
  vi.mocked(api.list).mockResolvedValueOnce({activities:[],clock:remote()});
  vi.mocked(api.detail).mockImplementationOnce(()=>pending.promise);
  const old=task.open('old');await flush();task.close();
  if(replacement)await task.open(activity.id);
  const current=task.state.clock;
  pending.resolve({activity:{...activity,id:'old'},clock:remote(60000)});await old;
  expect(task.state.clock).toEqual(current);expect(task.state.phase).toBe(replacement?'ready':'closed');
  if(replacement)expect(task.state.activity?.id).toBe(activity.id);
});
