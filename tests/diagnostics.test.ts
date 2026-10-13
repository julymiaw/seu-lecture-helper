import {expect, it, vi} from 'vitest';
import {Diagnostics, VERSION} from '../src/diagnostics';
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
  const error = new ApiError('验证码错误 secret-cookie data:image/png;base64,SECRET', 'business', 200, 42);
  await expect(new Diagnostics().measure('预约提交', async () => {throw error;})).rejects.toBe(error);
  expect(vi.mocked(console.warn).mock.calls[0][1]).toMatchObject({kind:'business', reason:'captcha-rejected', httpStatus:200, businessCode:42});
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
  const api = await mockApi(); const task = new Reservation(api, vi.fn(), () => NOW);
  await task.open((await sample()).id);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await task.submit('0733');
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
  const api = await mockApi({list:vi.fn(async () => ({activities:[a], offset:0}))});
  const task = new Reservation(api,vi.fn()); await task.open(a.id);
  const before = vi.mocked(console.log).mock.calls.length;
  await vi.advanceTimersByTimeAsync(3000);
  expect(vi.mocked(console.log).mock.calls).toHaveLength(before);
  task.close();
});
