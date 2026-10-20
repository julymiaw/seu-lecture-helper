import {describe, expect, it, vi} from 'vitest';
import {Api, ApiError, BASE, schoolTime} from '../src/api';
import raw from './fixtures/activities.json';
import my from './fixtures/my-activities.json';
import success from './fixtures/booking-success.json';
import failure from './fixtures/booking-captcha-error.json';
import detail from './fixtures/detail.json';
import {clone, envelope, NOW, response} from './helpers';

describe('protocol and samples', () => {
  it('merges by ID, handles mixed numeric fields, preserves distinct events', async () => {
    const fetcher = vi.fn(async () => response(raw));
    const result = await new Api(fetcher, () => NOW).list();
    expect(result.activities).toHaveLength(6);
    expect(result.activities[0]).toMatchObject({count: 626, capacity: 5000, reserved: true});
    expect(result.activities[1].reserved).toBe(false);
    expect(result.activities[2].id).not.toBe(result.activities[3].id);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(BASE + 'queryActivityList.do'); expect(init).toMatchObject({method:'POST', body:'', credentials:'same-origin'});
  });
  it('does not require server time to read activities or details', async () => {
    const data=clone(raw);delete (data.datas as {xtdqsj?:string}).xtdqsj;
    expect((await new Api(vi.fn(async()=>response(data))).list()).activities).toHaveLength(6);
    const info=clone(detail);delete (info.datas as {xtdqsj?:string}).xtdqsj;
    expect((await new Api(vi.fn(async()=>response(info))).detail(info.datas.hdxq.WID)).activity.id).toBe(info.datas.hdxq.WID);
  });
  it('uses timestamp GET for captcha and preserves MIME', async () => {
    const transport = vi.fn(async () => response(envelope('data:image/jpeg;base64,VEVTVA==')));
    expect(await new Api(transport, () => NOW).captcha()).toBe('data:image/jpeg;base64,VEVTVA==');
    expect(transport).toHaveBeenCalledWith(BASE+'vcode.do?_='+NOW, expect.objectContaining({method:'GET'}));
  });
  it('encodes submission as a form without fabricated cookie headers', async () => {
    const transport = vi.fn(async () => response(success)); await new Api(transport).submit('id&1','a+2');
    const [,init] = transport.mock.calls[0] as unknown as [string,RequestInit];
    expect(init.body).toBe('wid=id%261&vcode=a%2B2');
    expect(new Headers(init.headers).get('Cookie')).toBeNull();
    expect(new Headers(init.headers).get('Content-Type')).toContain('application/x-www-form-urlencoded');
  });
  it('does not confuse HTTP 200 with business success', async () => {
    await expect(new Api(vi.fn(async()=>response(failure))).submit('id','no')).rejects.toMatchObject({kind:'business',message:failure.msg});
  });
  it('requires datas=1 even with code=0', async () => {
    await expect(new Api(vi.fn(async()=>response(envelope(null)))).submit('id','no')).rejects.toMatchObject({kind:'format'});
  });
  it('verifies HD_WID, booking ID and cancellation, not title/WID alone', async () => {
    const transport = vi.fn(async () => response(my)); const api = new Api(transport);
    expect(await api.booked(raw.datas.hdlbList[0].WID)).toBe(true);
    expect(await api.booked('other')).toBe(false);
    expect((transport.mock.calls[0] as unknown as [string,RequestInit])[1].body).toBe('param=%7B%22FBZT%22%3A%221%22%7D');
    const changed=clone(my); changed.datas.wdhdList[0].FBZT='-1';
    expect(await new Api(vi.fn(async()=>response(changed))).booked(raw.datas.hdlbList[0].WID)).toBe(false);
    changed.datas.wdhdList[0].FBZT='1'; changed.datas.wdhdList[0].YY_WID='';
    expect(await new Api(vi.fn(async()=>response(changed))).booked(raw.datas.hdlbList[0].WID)).toBe(false);
  });
  it('reads the detail schema and rejects mismatched ID', async () => {
    const api = new Api(vi.fn(async()=>response(detail)),()=>NOW);
    expect((await api.detail(detail.datas.hdxq.WID)).activity.reserved).toBe(true);
    await expect(api.detail('other')).rejects.toMatchObject({kind:'format'});
  });
  it.each([401,403,429,500])('handles HTTP %i', async status => {
    await expect(new Api(vi.fn(async()=>response({},status))).captcha()).rejects.toBeInstanceOf(ApiError);
  });
  it('handles a redirected login page', async () => {
    const transport = vi.fn(async()=>({redirected:true,status:200} as Response));
    await expect(new Api(transport).captcha()).rejects.toMatchObject({kind:'session'});
  });
  it.each(['<html>login</html>','null','{}'])('rejects non-protocol data %s', async text => {
    await expect(new Api(vi.fn(async()=>new Response(text))).captcha()).rejects.toMatchObject({kind:'format'});
  });
  it('handles a disconnected request', async () => {
    await expect(new Api(vi.fn(async()=>{throw new TypeError('offline');})).captcha()).rejects.toMatchObject({kind:'network'});
  });
  it('times out even when response headers arrived but body stalls', async () => {
    vi.useFakeTimers();
    const transport = vi.fn(async (_:unknown, init?:RequestInit)=>({ok:true,status:200,redirected:false,text:()=>new Promise((_,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('abort'))))} as Response));
    const result = expect(new Api(transport,()=>NOW,100).captcha()).rejects.toMatchObject({kind:'network',message:'网络请求超时'});
    await vi.advanceTimersByTimeAsync(100); await result;
  });
  it('rejects bad image data and malformed collections', async () => {
    await expect(new Api(vi.fn(async()=>response(envelope('https://example.org/image')))).captcha()).rejects.toMatchObject({kind:'format'});
    await expect(new Api(vi.fn(async()=>response(envelope({xtdqsj:raw.datas.xtdqsj,hdlbList:null})))).list()).rejects.toMatchObject({kind:'format'});
  });
});
describe('Shanghai time', () => {
  it('parses independently of host timezone', () => expect(schoolTime('2026-10-12 16:00:00')).toBe(NOW));
  it.each(['bad','2026-02-30 12:00:00','2026-10-12 24:00:00'])('rejects %s', x => expect(()=>schoolTime(x)).toThrow());
});

describe('activity count parsing',()=>{
  it('distinguishes an explicit zero from absent count rows',async()=>{
    const data=clone(raw);data.datas.hdrsList=[{HD_WID:data.datas.hdlbList[0].WID,YYRS:0}];
    const result=await new Api(vi.fn(async()=>response(data)),()=>NOW).list();
    expect(result.activities[0]).toMatchObject({count:0,countKnown:true});
    expect(result.activities[1]).toMatchObject({count:0,countKnown:false});
  });
  it.each([null,'',-1,'bad',1.5])('does not treat invalid count %j as known',async count=>{
    const data=clone(raw);Object.assign(data.datas.hdrsList[0],{YYRS:count});
    const result=await new Api(vi.fn(async()=>response(data)),()=>NOW).list();
    expect(result.activities.find(x=>x.id===data.datas.hdrsList[0].HD_WID)?.countKnown).toBe(false);
  });
});

describe('diagnostic error metadata', () => {
  it('preserves HTTP and numeric business status without attaching the response', async () => {
    const api = new Api(vi.fn(async () => response({code:42,msg:'验证码错误',datas:null,secret:'private'})));
    try {await api.submit('id','0733'); throw new Error('expected rejection');}
    catch (error) {
      expect(error).toMatchObject({kind:'business',httpStatus:200,feedback:{code:42,datas:null,msg:'验证码错误'}});
      expect(JSON.stringify(error)).not.toContain('private');
    }
  });
  it.each([401,429,503])('preserves HTTP %i for diagnostics', async status => {
    const api = new Api(vi.fn(async () => response({},status)));
    await expect(api.captcha()).rejects.toMatchObject({httpStatus:status});
  });
});
