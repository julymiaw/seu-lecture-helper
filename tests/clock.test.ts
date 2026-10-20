import {expect,it,vi} from 'vitest';
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
it.each([-10000,10000])('server offset %s remains diagnostic and cannot move local capture or submit deadlines',async offset=>{
  const {task,api,activity,remote}=await setup();vi.mocked(api.detail).mockImplementation(async()=>({activity,clock:remote(offset,5000)}));task.start();
  await vi.advanceTimersByTimeAsync(20000);expect(task.state.clock?.offset).toBe(offset);
  expect(vi.mocked(console.log).mock.calls.some(call=>call[1]?.event==='服务器时间观测'&&call[1]?.timingApplied===false&&call[1]?.requestRttMs===5000)).toBe(true);
  await vi.advanceTimersByTimeAsync(9999);expect(api.captcha).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);expect(api.captcha).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30000);expect(api.submit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(49);expect(api.submit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);expect(api.submit).toHaveBeenCalledTimes(1);
  const row=vi.mocked(console.log).mock.calls.find(call=>call[1]?.event==='提交时机')?.[1];
  expect(row).toMatchObject({timingBasis:'local',afterOpenMs:50,submitDelayMs:50,dispatchLateMs:0,serverOffsetMs:offset,estimatedServerAfterOpenMs:offset+50});
});
it('failed final time observation does not interrupt the local submission deadline',async()=>{
  const {task,api}=await setup(),previous=task.state.clock;vi.mocked(api.detail).mockRejectedValue(new Error('offline'));task.start();
  await vi.advanceTimersByTimeAsync(20000);expect(task.state.clock).toEqual(previous);expect(task.state.phase).toBe('waiting');
  await vi.advanceTimersByTimeAsync(40050);expect(api.submit).toHaveBeenCalledTimes(1);
});
it('late heartbeat errors after captcha preparation cannot pause or replace the task',async()=>{
  const {ApiError}=await import('../src/api'),{task,api}=await setup();
  const pending=deferred<Awaited<ReturnType<typeof api.detail>>>();vi.mocked(api.detail).mockImplementationOnce(()=>pending.promise);task.start();
  await vi.advanceTimersByTimeAsync(30000);expect(task.state.phase).toBe('prepared');
  pending.reject(new ApiError('登录失效','session',401));await flush();expect(task.state.phase).toBe('prepared');
  await vi.advanceTimersByTimeAsync(30050);expect(task.state.phase).toBe('success');
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
