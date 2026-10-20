import {clockSample} from './helpers';
import {expect, it, vi} from 'vitest';
import {Diagnostics, VERSION} from '../src/diagnostics';
const engine=()=>({prepare:async()=>{},recognize:async()=> '0733'});
import {ApiError} from '../src/api';
it('correlates stages and records durations without logging return values', async () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(100);
  const log = vi.mocked(console.log); const task = new Diagnostics();
  expect(await task.measure('OCR识别', async () => {clock.mockReturnValue(125); return '0733';})).toBe('0733');
  const start = log.mock.calls[0][1], end = log.mock.calls[1][1];
  expect(start).toMatchObject({version: VERSION, event:'OCR识别开始'});
  expect(end).toMatchObject({task:start.task, durationMs:25, elapsedMs:25, stale:false});
  expect(JSON.stringify(log.mock.calls)).not.toContain('0733');
});
it('logs safe error classifications and rethrows the original error', async () => {
  const error = new ApiError('验证码错误 secret-cookie data:image/png;base64,SECRET', 'business', 200);
  await expect(new Diagnostics().measure('预约提交', async () => {throw error;})).rejects.toBe(error);
  expect(vi.mocked(console.warn).mock.calls[0][1]).toMatchObject({kind:'business', reason:'captcha-rejected', httpStatus:200});
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('SECRET');
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('secret-cookie');
});
it('marks late results and assigns distinct task IDs', async () => {
  const a = new Diagnostics(), b = new Diagnostics();
  await a.measure('查询', async () => true, {}, () => true); b.record('log','打开');
  const calls = vi.mocked(console.log).mock.calls;
  expect(calls[1][1]).toMatchObject({stale:true});
  expect(calls[0][1].task).not.toBe(calls[2][1].task);
});
it('does not let broken console instrumentation interrupt operations', async () => {
  vi.mocked(console.log).mockImplementation(() => {throw new Error('console unavailable');});
  await expect(new Diagnostics().measure('查询', async () => 1)).resolves.toBe(1);
});
it('traces a complete reservation without exposing captcha data', async () => {
  const {Reservation} = await import('../src/reservation');
  const {mockApi, NOW, sample} = await import('./helpers');
  vi.useFakeTimers();vi.setSystemTime(NOW);
  const api = await mockApi(); const task = new Reservation(api, vi.fn(), () => NOW,engine());
  await task.open((await sample()).id); task.start();
  for (let i = 0; i < 60; i++) await Promise.resolve();
  const logs = vi.mocked(console.log).mock.calls.map(call => call[1]);
  expect(logs.map(row => row.event)).toEqual(expect.arrayContaining(['验证码获取开始','验证码获取完成','预约提交开始','预约提交完成','预约记录核验完成','核验结果']));
  expect(logs.find(row => row.phase === 'success')).toMatchObject({round:1, submissions:1});
  expect(JSON.stringify(logs)).not.toContain('0733');
  expect(JSON.stringify(logs)).not.toContain('data:image');
});
it('does not log each countdown tick', async () => {
  vi.useFakeTimers();
  const {Reservation} = await import('../src/reservation');
  const {mockApi, NOW, sample} = await import('./helpers');
  vi.setSystemTime(NOW);
  const a = {...await sample(), reserved:false, startsAt:NOW+10000};
  const api = await mockApi({list:vi.fn(async () => ({activities:[a], clock:clockSample()}))});
  const task = new Reservation(api,vi.fn(),Date.now,engine()); await task.open(a.id); task.start();
  for(let i=0;i<60;i++)await Promise.resolve();
  const before = vi.mocked(console.log).mock.calls.length;
  await vi.advanceTimersByTimeAsync(3000);
  expect(vi.mocked(console.log).mock.calls).toHaveLength(before);
  task.close();
});
it('records concrete business feedback but omits images, credential fields and captcha answers',async()=>{
  const {Api}=await import('../src/api');
  const api=new Api(vi.fn(async()=>new Response(JSON.stringify({code:-1,datas:null,msg:'尚未开放预约',debugException:'private'}))));
  await expect(new Diagnostics().measure('预约提交',()=>api.submit('id','0733'))).rejects.toBeInstanceOf(ApiError);
  expect(vi.mocked(console.warn).mock.calls[0][1]).toMatchObject({serverMessage:'尚未开放预约',responseCode:-1,responseData:'null',reason:'not-open'});
  const unsafe=new Api(vi.fn(async()=>new Response(JSON.stringify({code:-1,datas:{token:'private'},msg:'验证码 0733 token=private data:image/png;base64,SECRET'}))));
  await expect(new Diagnostics().measure('预约提交',()=>unsafe.submit('id','0733'))).rejects.toBeInstanceOf(ApiError);
  const logs=JSON.stringify(vi.mocked(console.warn).mock.calls);expect(logs).not.toContain('0733');expect(logs).not.toContain('private');expect(logs).not.toContain('SECRET');
});
it('uses warnings for expected API failures and errors for malformed or unexpected failures',async()=>{
  for(const kind of ['business','network','session','rate'] as const){
    await expect(new Diagnostics().measure('stage',async()=>{throw new ApiError('expected',kind);})).rejects.toBeInstanceOf(ApiError);
  }
  expect(console.warn).toHaveBeenCalledTimes(4);expect(console.error).not.toHaveBeenCalled();
  for(const error of [new ApiError('bad schema','format'),new TypeError('unexpected')]){
    await expect(new Diagnostics().measure('stage',async()=>{throw error;})).rejects.toBe(error);
  }
  expect(console.error).toHaveBeenCalledTimes(2);
});
it('opening a full activity reports a business warning without a console error',async()=>{
  const {Reservation}=await import('../src/reservation');const {mockApi,sample,NOW}=await import('./helpers');
  const activity={...await sample(),reserved:false,count:5000,capacity:5000,countKnown:true};
  const api=await mockApi({list:vi.fn(async()=>({activities:[activity],clock:clockSample()}))});
  const task=new Reservation(api,vi.fn(),()=>NOW,engine());await task.open(activity.id);
  expect(task.state.phase).toBe('failed');expect(console.error).not.toHaveBeenCalled();
  expect(vi.mocked(console.warn).mock.calls.some(call=>call[1]?.event==='状态变化' && call[1]?.reason==='full')).toBe(true);
});
it('records captcha holding time, OCR wait and last successful session check at submission',async()=>{
  vi.useFakeTimers();const {Reservation}=await import('../src/reservation');const {mockApi,NOW,sample}=await import('./helpers');vi.setSystemTime(NOW);
  const activity={...await sample(),reserved:false,startsAt:NOW+180000},api=await mockApi({list:vi.fn(async()=>({activities:[activity],clock:clockSample()}))});
  const task=new Reservation(api,vi.fn(),Date.now,engine());await task.open(activity.id);task.start();await vi.advanceTimersByTimeAsync(180000);
  const logs=vi.mocked(console.log).mock.calls.map(call=>call[1]),submit=logs.find(e=>e.event==='提交时机');
  expect(submit).toMatchObject({captchaHeldMs:30000,captchaRequestAgeMs:30000,ocrWaitMs:30000,lastSessionCheckAt:NOW+140000,sessionCheckAgeMs:40000,afterOpenMs:0});
  expect(logs.find(e=>e.event==='验证码到达')).toMatchObject({round:1,requestAttempt:1,captchaReceivedAt:NOW+150000});expect(task.state.phase).toBe('success');
});
it('keeps a stable run ID across recovery while each execution has its own task ID',async()=>{
  const a=new Diagnostics(),b=new Diagnostics(a.run);a.record('log','first');b.record('log','recovered');const calls=vi.mocked(console.log).mock.calls;expect(calls[0][1].run).toBe(calls[1][1].run);expect(calls[0][1].task).not.toBe(calls[1][1].task);
});
it.each(['验证码错误 authorization: Bearer SECRET_AUTH','{"token":"SECRET_TOKEN","password":"SECRET_PASSWORD"}','Cookie: first=SECRET_ONE; second=SECRET_TWO','password:\nSECRET_MULTILINE'])('omits credential-bearing business feedback from diagnostics: %s',async msg=>{
  const {Api}=await import('../src/api');const api=new Api(vi.fn(async()=>new Response(JSON.stringify({code:-1,datas:null,msg}))));
  await expect(new Diagnostics().measure('预约提交',()=>api.submit('id','0733'))).rejects.toBeInstanceOf(ApiError);
  const logs=JSON.stringify(vi.mocked(console.warn).mock.calls);expect(logs).not.toContain('SECRET');expect(logs).toContain('[credential]');
});
