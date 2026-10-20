import {expect,it,vi} from 'vitest';
import {saveTask,readTask,clearTask} from '../src/task-store';
import {sample,NOW,trackedStorage} from './helpers';
it('refresh recovery stores only task intent, never credentials or captcha',async()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);sessionStorage.clear();const activity=await sample();
  saveTask({phase:'waiting',message:'',activity,armed:true,code:'0733'});
  expect(readTask()).toEqual({id:activity.id,endsAt:activity.endsAt,verify:false});expect(JSON.stringify(sessionStorage)).not.toContain('0733');clearTask();expect(readTask()).toBeUndefined();
});
it('unknown writes restore only for verification and terminal outcomes clear intent',async()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);sessionStorage.clear();const activity=await sample();
  saveTask({phase:'submitting',message:'',activity,armed:true});expect(readTask()?.verify).toBe(true);
  saveTask({phase:'login-required',message:'',activity,armed:true,verifyAfterLogin:true});expect(readTask()?.verify).toBe(true);
  saveTask({phase:'success',message:'',activity});expect(readTask()).toBeUndefined();
});
it('ignores expired or malformed recovery records',()=>{
  sessionStorage.setItem('seu-lecture-pending-task','{"id":"x","endsAt":1,"leadSeconds":30,"verify":false}');expect(readTask()).toBeUndefined();
  sessionStorage.setItem('seu-lecture-pending-task','bad');expect(readTask()).toBeUndefined();
});
it('saves a versioned candidate group, active index, with a verification barrier',async()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);sessionStorage.clear();const a={...await sample(),id:'online'},b={...a,id:'offline'};
  saveTask({phase:'submitting',message:'',activity:b,candidates:[a,b],candidateIndex:1,preferred:'online',armed:true});
  expect(readTask()).toMatchObject({version:2,id:'offline',ids:['online','offline'],index:1,preferred:'online',verify:true});
  saveTask({phase:'waiting',message:'',activity:b,candidates:[a,b],candidateIndex:1,preferred:'online',armed:true});expect(readTask()?.verify).toBe(false);
});
it('rejects inconsistent candidate recovery records rather than guessing a target',()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);
  const base={version:2,id:'offline',ids:['online','offline'],index:1,preferred:'online',endsAt:NOW+10000,leadSeconds:30,verify:false};
  for(const bad of [{...base,index:0},{...base,ids:['offline','offline']},{...base,preferred:'unknown'},{...base,version:3}]){
    sessionStorage.setItem('seu-lecture-pending-task',JSON.stringify(bad));expect(readTask()).toBeUndefined();
  }
});
it('writes only changed intent and retries a failed write instead of remembering it as saved',async()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);sessionStorage.clear();
  const activity=await sample(),storage=trackedStorage(),set=storage.setItem;
  const state={phase:'waiting' as const,message:'',activity,armed:true};
  set.mockImplementationOnce(()=>{throw new Error('storage unavailable');});
  saveTask(state,storage);expect(readTask(storage)).toBeUndefined();
  saveTask(state,storage);expect(set).toHaveBeenCalledTimes(2);expect(readTask(storage)?.id).toBe(activity.id);
  for(let remaining=10000;remaining>0;remaining-=250)saveTask({...state,remaining},storage);
  expect(set).toHaveBeenCalledTimes(2);
  saveTask({...state,phase:'submitting'},storage);expect(set).toHaveBeenCalledTimes(3);expect(readTask(storage)?.verify).toBe(true);
  saveTask({...state,phase:'failed'},storage);expect(readTask(storage)).toBeUndefined();
});
it('ignores unused legacy timing fields, including on expired writes pending verification',()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);
  sessionStorage.setItem('seu-lecture-pending-task',JSON.stringify({id:'legacy',endsAt:NOW-1,verify:true,leadSeconds:'unused'}));
  expect(readTask()).toMatchObject({id:'legacy',verify:true});
});
