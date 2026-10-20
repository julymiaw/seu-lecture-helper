import {expect,it,vi} from 'vitest';
import {Reservation} from '../src/reservation';
import {ApiError} from '../src/api';
import {readTask,saveTask} from '../src/task-store';
import {NOW,sample,mockApi,trackedStorage} from './helpers';
const engine=()=>({prepare:vi.fn(async()=>{}),recognize:vi.fn(async()=> '0733')});
const flush=async()=>{for(let i=0;i<70;i++)await Promise.resolve();};
it.each([0,1])('repeated authentication failures preserve candidate group and priority at index %s',async index=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);sessionStorage.clear();
  const online={...await sample(),id:'on',title:'【线上】同一讲座',reserved:false,startsAt:NOW+180000},offline={...online,id:'off',title:'【线下】同一讲座',place:'报告厅'};
  const intent={verify:false,ids:['off','on'],index,preferred:'offline' as const};
  const api=await mockApi({list:vi.fn(async()=>({activities:[online,offline],offset:0})),captcha:vi.fn(async()=>{throw new ApiError('未登录','session',401);})});
  const task=new Reservation(api,s=>saveTask(s),Date.now,engine());await task.open(intent.ids[index],intent);task.start();await vi.advanceTimersByTimeAsync(60000);
  expect(task.state.phase).toBe('login-required');const before=readTask();expect(before).toMatchObject(intent);
  vi.mocked(api.list).mockRejectedValueOnce(new ApiError('未登录','session',401)).mockRejectedValueOnce(new ApiError('未登录','session',401));
  await task.resume();expect(readTask()).toEqual(before);await task.resume();expect(readTask()).toEqual(before);expect(task.state.candidates).toHaveLength(2);task.close();
  const saved=readTask()!,restored=new Reservation(api,vi.fn(),Date.now,engine());await restored.open(saved.id,saved);
  expect(restored.state.candidateIndex).toBe(index);expect(restored.state.preferred).toBe('offline');restored.close();
});
it.each([false,true])('expired pending %s-group writes restore verification without metadata, OCR or resubmission',async group=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);sessionStorage.clear();const online={...await sample(),id:'on',endsAt:NOW-1},offline={...online,id:'off'};
  saveTask({phase:'unknown',message:'',activity:group?offline:online,candidates:group?[online,offline]:[online],candidateIndex:group?1:0,preferred:'online'});
  const saved=readTask()!;expect(saved.verify).toBe(true);const api=await mockApi({list:vi.fn(async()=>{throw new Error('metadata must not be needed');})}),ocr=engine();
  const task=new Reservation(api,s=>saveTask(s),Date.now,ocr);await task.open(saved.id,saved);await task.restoreVerification();
  expect(task.state.phase).toBe('success');expect(api.booked).toHaveBeenCalledWith(saved.id);expect(api.submit).not.toHaveBeenCalled();expect(api.captcha).not.toHaveBeenCalled();expect(api.list).not.toHaveBeenCalled();expect(ocr.prepare).not.toHaveBeenCalled();expect(readTask()).toBeUndefined();
});
it('an expired write that remains unknown keeps its verification barrier through another login failure',async()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);sessionStorage.clear();const activity={...await sample(),endsAt:NOW-1};saveTask({phase:'unknown',message:'',activity});const saved=readTask()!;
  const api=await mockApi({booked:vi.fn(async()=>false)}),task=new Reservation(api,s=>saveTask(s),Date.now,engine());await task.open(saved.id,saved);const verify=task.restoreVerification();await vi.runAllTimersAsync();await verify;
  expect(task.state.phase).toBe('unknown');expect(readTask()).toEqual(saved);
  vi.mocked(api.booked).mockRejectedValueOnce(new ApiError('未登录','session',401));await task.verify();expect(task.state.phase).toBe('login-required');expect(readTask()).toEqual(saved);
  vi.mocked(api.booked).mockResolvedValue(true);await task.resume();await flush();expect(task.state.phase).toBe('success');expect(api.submit).not.toHaveBeenCalled();expect(readTask()).toBeUndefined();
});

it.each(['network','format'] as const)('a %s failure loading recovery metadata retains the original task for another reload',async kind=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);sessionStorage.clear();const activity={...await sample(),endsAt:NOW+180000};saveTask({phase:'waiting',message:'',activity,armed:true});const saved=readTask()!;
  const api=await mockApi({list:vi.fn(async()=>{throw new ApiError('temporary metadata failure',kind,502);})});
  const task=new Reservation(api,s=>saveTask(s),Date.now,engine());await task.open(saved.id,saved);
  expect(task.state.phase).toBe('failed');expect(readTask()).toEqual(saved);expect(api.captcha).not.toHaveBeenCalled();expect(api.submit).not.toHaveBeenCalled();
});
it('same-page verification login recovery preserves the candidate display and publishes the verified ID',async()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);sessionStorage.clear();const online={...await sample(),id:'on',title:'【线上】【艺术】同一讲座',reserved:false,startsAt:NOW-1000},offline={...online,id:'off',title:'【线下】【艺术】同一讲座',place:'报告厅'};
  const api=await mockApi({list:vi.fn(async()=>({activities:[online,offline],offset:0})),submit:vi.fn().mockRejectedValueOnce(new ApiError('人数已满','business')).mockRejectedValueOnce(new ApiError('未登录','session',401))});
  const task=new Reservation(api,s=>saveTask(s),Date.now,engine());await task.open(online.id);task.start();await flush();expect(task.state.phase).toBe('login-required');const candidates=task.state.candidates;
  await task.resume();expect(task.state.phase).toBe('success');expect(task.state.activity?.title).toBe(offline.title);expect(task.state.activity?.reserved).toBe(true);expect(task.state.verifiedId).toBe('off');expect(task.state.candidates).toEqual(candidates);expect(task.state.fullIds).toEqual(['on']);expect(task.state.candidateIndex).toBe(1);expect(api.list).toHaveBeenCalledTimes(1);expect(api.submit).toHaveBeenCalledTimes(2);expect(readTask()).toBeUndefined();
});
it('countdown ticks do not rewrite intent, but changing candidates and entering submit are saved immediately',async()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);sessionStorage.clear();
  const online={...await sample(),id:'on',title:'【线上】同一讲座',reserved:false,startsAt:NOW+60000};
  const offline={...online,id:'off',title:'【线下】同一讲座'};
  const writes:ReturnType<typeof readTask>[]=[],storage=trackedStorage(),set=storage.setItem;
  const api=await mockApi({list:vi.fn(async()=>({activities:[online,offline],offset:0})),submit:vi.fn(async()=>{
    writes.push(readTask(storage));
    if(readTask(storage)?.id==='on')throw new ApiError('人数已满','business');
  })});
  const task=new Reservation(api,s=>saveTask(s,storage),Date.now,engine());await task.open('on');task.start();
  await vi.advanceTimersByTimeAsync(10000);expect(set).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(50000);await flush();
  expect(writes.map(row=>({id:row?.id,index:row?.index,verify:row?.verify}))).toEqual([
    {id:'on',index:0,verify:true},{id:'off',index:1,verify:true},
  ]);
  expect(task.state.phase).toBe('success');expect(readTask(storage)).toBeUndefined();
});
