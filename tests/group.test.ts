import {clockSample} from './helpers';
import {expect,it,vi} from 'vitest';
import {Reservation,controls,type Recovery} from '../src/reservation';
import {ApiError} from '../src/api';
import {sample,mockApi,NOW,deferred} from './helpers';
const flush=async()=>{for(let i=0;i<70;i++)await Promise.resolve();};
async function setup(recovery?:Recovery,unlabelled=false){
  vi.useFakeTimers();vi.setSystemTime(NOW);
  const online={...await sample(),id:'online',title:unlabelled?'同一讲座':'【线上】同一讲座',reserved:false,startsAt:NOW-1000};
  const offline={...online,id:'offline',title:unlabelled?'同一讲座':'【线下】同一讲座',place:'线下报告厅'};
  const api=await mockApi({list:vi.fn(async()=>({activities:[offline,online],clock:clockSample()}))});
  const engine={prepare:vi.fn(async()=>{}),recognize:vi.fn(async()=> '0733')};
  const task=new Reservation(api,vi.fn(),Date.now,engine);await task.open(recovery?.ids?.[recovery.index??0]??'offline',recovery);await flush();return{task,api,online,offline};
}
it('defaults to online and only obtains the second captcha after the full response settles',async()=>{
  const{task,api}=await setup();const first=deferred<void>();vi.mocked(api.submit).mockImplementationOnce(()=>first.promise);
  task.start();await flush();expect(api.submit).toHaveBeenCalledWith('online','0733');expect(api.captcha).toHaveBeenCalledTimes(1);
  first.reject(new ApiError('当前活动预约人数已满，请重新选择','business'));await flush();
  expect(vi.mocked(api.submit).mock.calls.map(a=>a[0])).toEqual(['online','offline']);expect(api.captcha).toHaveBeenCalledTimes(2);expect(task.state.phase).toBe('success');expect(vi.mocked(console.warn).mock.calls.some(call=>call[1]?.action==='切换下一候选')).toBe(true);
});
it('allows offline preference only before starting; success never touches the backup',async()=>{
  const{task,api}=await setup();task.prefer('offline');task.start();task.prefer('online');await flush();
  expect(vi.mocked(api.submit).mock.calls.map(a=>a[0])).toEqual(['offline']);expect(api.captcha).toHaveBeenCalledTimes(1);expect(task.state.preferred).toBe('offline');
});
it.each(['验证码错误','尚未开放预约'])('keeps %s on the same candidate until an explicit full response',async msg=>{
  const{task,api}=await setup();vi.mocked(api.submit).mockRejectedValueOnce(new ApiError(msg,'business')).mockRejectedValueOnce(new ApiError('人数已满','business'));
  task.start();await flush();expect(vi.mocked(api.submit).mock.calls.map(a=>a[0])).toEqual(['online','online','offline']);expect(api.captcha).toHaveBeenCalledTimes(3);
  expect(vi.mocked(console.warn).mock.calls.filter(call=>call[1]?.event==='提交处理决定').map(call=>call[1].action)).toEqual(['当前场次换图重试','切换下一候选']);
});
it('all-full stops once, without revisiting online or polling',async()=>{
  const{task,api}=await setup();vi.mocked(api.submit).mockRejectedValue(new ApiError('人数已满','business'));task.start();await flush();await vi.advanceTimersByTimeAsync(60000);
  expect(vi.mocked(api.submit).mock.calls.map(a=>a[0])).toEqual(['online','offline']);expect(task.state.phase).toBe('failed');expect(vi.mocked(console.warn).mock.calls.some(call=>call[1]?.action==='停止：所有候选已满')).toBe(true);
});
it('unknown writes verify the current candidate and never advance on timeout or false records',async()=>{
  const{task,api}=await setup();vi.mocked(api.submit).mockRejectedValue(new ApiError('网络请求超时','network'));vi.mocked(api.booked).mockResolvedValue(false);
  task.start();await flush();await vi.advanceTimersByTimeAsync(3000);await flush();expect(task.state.phase).toBe('unknown');expect(api.submit).toHaveBeenCalledTimes(1);expect(api.submit).toHaveBeenCalledWith('online','0733');expect(api.booked).toHaveBeenCalledTimes(3);
});
it.each(['rate','session','format'] as const)('%s does not advance to a fallback',async kind=>{
  const{task,api}=await setup();vi.mocked(api.submit).mockRejectedValue(new ApiError('拒绝',kind));task.start();await flush();
  expect(api.submit).toHaveBeenCalledTimes(1);expect(task.state.activity?.id).toBe('online');
  expect(vi.mocked(console.warn).mock.calls.find(call=>call[1]?.event==='提交处理决定')?.[1].action).toBe(kind==='session'?'等待登录恢复':kind==='rate'?'停止':'核验当前预约');
});
it('uses only the clicked target when mode classification fails, without manual labeling',async()=>{
  const{task,api}=await setup(undefined,true);expect(task.state.candidates).toHaveLength(1);expect(controls(task.state).start).toBe(true);task.start();await flush();expect(api.submit).toHaveBeenCalledExactlyOnceWith('offline','0733');
});
it('restores the second candidate and verifies only, with no new captcha or write',async()=>{
  const{task,api}=await setup({ids:['online','offline'],index:1,preferred:'online',verify:true});await task.restoreVerification();
  expect(api.booked).toHaveBeenCalledWith('offline');expect(api.submit).not.toHaveBeenCalled();expect(api.captcha).not.toHaveBeenCalled();
});
it('does not silently upgrade an old saved single task into a candidate group',async()=>{
  const{task,api}=await setup({verify:false});expect(task.state.candidates).toHaveLength(1);task.start();await flush();expect(api.submit).toHaveBeenCalledWith('offline','0733');
});
it('session recovery on the second candidate keeps the group index and only verifies a pending write',async()=>{
  const{task,api}=await setup();vi.mocked(api.submit).mockRejectedValueOnce(new ApiError('人数已满','business')).mockRejectedValueOnce(new ApiError('登录失效','session',401));task.start();await flush();
  expect(task.state.phase).toBe('login-required');expect(task.state.candidateIndex).toBe(1);await task.resume();expect(api.booked).toHaveBeenCalledWith('offline');expect(api.submit).toHaveBeenCalledTimes(2);expect(task.state.phase).toBe('success');
});
it('an existing booking in either variant prevents any new write',async()=>{
  const{task,api,online,offline}=await setup();vi.mocked(api.list).mockResolvedValue({activities:[{...offline,reserved:true},online],clock:clockSample()});await task.open('online');task.start();await flush();
  expect(task.state.phase).toBe('success');expect(task.state.activity?.id).toBe('offline');expect(task.state.candidateIndex).toBe(1);expect(api.submit).not.toHaveBeenCalled();
});

it('declining the additional candidate keeps the clicked variant even when the default preferred online',async()=>{
  const{task,api}=await setup();task.single('offline');expect(task.state.candidates).toHaveLength(1);task.start();await flush();expect(api.submit).toHaveBeenCalledWith('offline','0733');
});
it('inline candidate choice blocks starting until a decision, without starting either target',async()=>{
  const{task,api}=await setup();task.requestPairChoice('offline');expect(task.state.phase).toBe('choosing');expect(controls(task.state).start).toBe(false);task.start();expect(api.captcha).not.toHaveBeenCalled();
  task.choosePair(true);expect(task.state.phase).toBe('ready');expect(task.state.candidates).toHaveLength(2);expect(api.submit).not.toHaveBeenCalled();
  task.requestPairChoice('offline');task.choosePair(false);expect(task.state.activity?.id).toBe('offline');expect(task.state.candidates).toHaveLength(1);
});

it('legacy unclassified groups recover only the current target, without using saved labels',async()=>{
  const{task,api}=await setup({ids:['online','offline'],index:1,preferred:'online',verify:false},true);expect(task.state.candidates?.map(a=>a.id)).toEqual(['offline']);expect(task.state.candidateIndex).toBe(0);task.start();await flush();expect(api.submit).toHaveBeenCalledExactlyOnceWith('offline','0733');
});
it('a booked alternate in a legacy unclassified group still prevents any new write',async()=>{
  const{task,api,online,offline}=await setup(undefined,true);vi.mocked(api.list).mockResolvedValue({activities:[{...online,reserved:true},offline],clock:clockSample()});await task.open('offline',{ids:['online','offline'],index:1,preferred:'online',verify:false});task.start();await flush();expect(task.state.phase).toBe('success');expect(task.state.activity?.id).toBe('online');expect(api.submit).not.toHaveBeenCalled();
});

it.each(['rescheduled','renamed','ambiguous'] as const)('restores only the current target when the saved pair becomes %s',async change=>{
  const {task,api,online,offline}=await setup();
  const alternate=change==='rescheduled'?{...offline,eventStart:'2099-01-01'}:change==='renamed'?{...offline,title:'【线下】不同讲座'}:offline;
  const activities=[online,alternate,...(change==='ambiguous'?[{...offline,id:'third'}]:[])];
  vi.mocked(api.list).mockResolvedValue({activities,clock:clockSample()});
  await task.open('online',{ids:['online','offline'],index:0,preferred:'online',verify:false});
  expect(task.state.candidates?.map(a=>a.id)).toEqual(['online']);
  vi.mocked(api.submit).mockRejectedValue(new ApiError('人数已满','business'));
  task.start();await flush();expect(api.submit).toHaveBeenCalledExactlyOnceWith('online','0733');expect(task.state.phase).toBe('failed');
});
