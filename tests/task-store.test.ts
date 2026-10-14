import {expect,it,vi} from 'vitest';
import {saveTask,readTask,clearTask} from '../src/task-store';
import {sample,NOW} from './helpers';
it('refresh recovery stores only task intent, never credentials or captcha',async()=>{
  vi.useFakeTimers();vi.setSystemTime(NOW);sessionStorage.clear();const activity=await sample();
  saveTask({phase:'waiting',message:'',activity,armed:true,leadSeconds:20,image:'secret-image',code:'0733'});
  expect(readTask()).toEqual({id:activity.id,leadSeconds:20,endsAt:activity.endsAt,verify:false});expect(JSON.stringify(sessionStorage)).not.toContain('secret-image');expect(JSON.stringify(sessionStorage)).not.toContain('0733');clearTask();expect(readTask()).toBeUndefined();
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
