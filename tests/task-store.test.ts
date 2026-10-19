import {expect,it,vi} from 'vitest';
import {saveTask,readTask,clearTask} from '../src/task-store';
import {sample,NOW} from './helpers';
it('refresh recovery stores only task intent, never credentials or captcha',async()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);sessionStorage.clear();const activity=await sample();
  saveTask({phase:'waiting',message:'',activity,armed:true,image:'secret-image',code:'0733'});
  expect(readTask()).toEqual({id:activity.id,leadSeconds:30,endsAt:activity.endsAt,verify:false});expect(JSON.stringify(sessionStorage)).not.toContain('secret-image');expect(JSON.stringify(sessionStorage)).not.toContain('0733');clearTask();expect(readTask()).toBeUndefined();
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
it('saves a versioned candidate group, active index and labels, with a verification barrier',async()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);sessionStorage.clear();const a={...await sample(),id:'online'},b={...a,id:'offline'};
  saveTask({phase:'submitting',message:'',activity:b,candidates:[a,b],candidateIndex:1,preferred:'online',labels:{online:'online',offline:'offline'},armed:true});
  expect(readTask()).toMatchObject({version:2,id:'offline',ids:['online','offline'],index:1,preferred:'online',verify:true,labels:{online:'online',offline:'offline'}});
  saveTask({phase:'waiting',message:'',activity:b,candidates:[a,b],candidateIndex:1,preferred:'online',armed:true});expect(readTask()?.verify).toBe(false);
});
it('rejects inconsistent candidate recovery records rather than guessing a target',()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);
  const base={version:2,id:'offline',ids:['online','offline'],index:1,preferred:'online',endsAt:NOW+10000,leadSeconds:30,verify:false};
  for(const bad of [{...base,index:0},{...base,ids:['offline','offline']},{...base,preferred:'unknown'},{...base,labels:{offline:'unknown'}},{...base,version:3}]){
    sessionStorage.setItem('seu-lecture-pending-task',JSON.stringify(bad));expect(readTask()).toBeUndefined();
  }
});
