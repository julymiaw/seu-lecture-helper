import {expect,it,vi} from 'vitest';
import {Reservation} from '../src/reservation';
import {ApiError} from '../src/api';
import {NOW,sample,mockApi,deferred} from './helpers';
const flush=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
async function setup() {
  vi.useFakeTimers();vi.setSystemTime(NOW);
  const activity={...await sample(),reserved:false,startsAt:NOW+60000,endsAt:NOW+120000};
  const api=await mockApi({list:vi.fn(async()=>({activities:[activity]})),detail:vi.fn(async()=>({activity}))});
  const task=new Reservation(api,vi.fn(),Date.now,{prepare:async()=>{},recognize:async()=> '0733'});
  await task.open(activity.id);await flush();return {task,api,activity};
}
it('captures at local T-30s and submits exactly once at T+50ms',async()=>{
  const {task,api}=await setup();task.start();
  await vi.advanceTimersByTimeAsync(29999);expect(api.captcha).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);expect(api.captcha).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(30000);expect(api.submit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(49);expect(api.submit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);expect(api.submit).toHaveBeenCalledTimes(1);
  const row=vi.mocked(console.log).mock.calls.find(call=>call[1]?.event==='提交时机')?.[1];
  expect(row).toMatchObject({afterOpenMs:50,dispatchLateMs:0});
});
it('failed final session check does not interrupt the local deadline',async()=>{
  const {task,api}=await setup();vi.mocked(api.detail).mockRejectedValue(new ApiError('offline','network'));task.start();
  await vi.advanceTimersByTimeAsync(20000);expect(task.state.phase).toBe('waiting');
  await vi.advanceTimersByTimeAsync(40050);expect(api.submit).toHaveBeenCalledTimes(1);
});
it('late heartbeat errors after captcha preparation cannot pause the task',async()=>{
  const {task,api}=await setup(),pending=deferred<Awaited<ReturnType<typeof api.detail>>>();
  vi.mocked(api.detail).mockImplementationOnce(()=>pending.promise);task.start();
  await vi.advanceTimersByTimeAsync(30000);expect(task.state.phase).toBe('prepared');
  pending.reject(new ApiError('登录失效','session',401));await flush();expect(task.state.phase).toBe('prepared');
  await vi.advanceTimersByTimeAsync(30050);expect(task.state.phase).toBe('success');
});
it('closing invalidates an outstanding session check and cancels submission',async()=>{
  const {task,api,activity}=await setup(),pending=deferred<Awaited<ReturnType<typeof api.detail>>>();
  vi.mocked(api.detail).mockImplementationOnce(()=>pending.promise);task.start();await vi.advanceTimersByTimeAsync(20000);task.close();
  pending.resolve({activity});await flush();await vi.advanceTimersByTimeAsync(60000);
  expect(task.state.phase).toBe('closed');expect(api.captcha).not.toHaveBeenCalled();expect(api.submit).not.toHaveBeenCalled();
});
it.each([false,true])('late detail fallback cannot overwrite a closed or replacement task; replacement=%s',async replacement=>{
  const {task,api,activity}=await setup(),pending=deferred<Awaited<ReturnType<typeof api.detail>>>();
  vi.mocked(api.list).mockResolvedValueOnce({activities:[]});vi.mocked(api.detail).mockImplementationOnce(()=>pending.promise);
  const old=task.open('old');await flush();task.close();if(replacement)await task.open(activity.id);
  pending.resolve({activity:{...activity,id:'old'}});await old;
  expect(task.state.phase).toBe(replacement?'ready':'closed');if(replacement)expect(task.state.activity?.id).toBe(activity.id);
});
