import {beforeEach,expect,it,vi} from 'vitest';
import {LogStore,MAX_EVENTS,type LogEntry} from '../src/log-store';
import {NOW,deferred} from './helpers';
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(NOW);});
function fixture(){
  const data=new Map<string,Response>();
  const cache={match:vi.fn(async(key:RequestInfo)=>data.get(typeof key==='string'?key:(key as Request).url)?.clone()),put:vi.fn(async(key:RequestInfo,value:Response)=>{data.set(String(key),value.clone());}),keys:vi.fn(async()=>[...data.keys()].map(key=>new Request(key))),delete:vi.fn(async(key:RequestInfo)=>data.delete(typeof key==='string'?key:(key as Request).url))} as unknown as Cache;
  return {cache,data,open:vi.fn(async()=>cache)};
}
const row=(run='run-a',task='segment-a',seq=1):LogEntry=>({run,task,seq,at:new Date().toISOString(),version:'test',level:'log',event:'测试事件'});
it('saves JSON asynchronously and a new page can export it',async()=>{
  const f=fixture(),store=new LogStore(f.open),entry=row();store.append(entry);expect(f.open).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(500);await store.flush();
  const restored=await new LogStore(f.open).export();expect(restored.runs).toHaveLength(1);expect(restored.runs[0].events).toEqual([entry]);expect(restored.storageWarning).toBeUndefined();
});
it('merges restored segments and does not overwrite events when an older page writes again',async()=>{
  const f=fixture(),a=new LogStore(f.open),b=new LogStore(f.open);a.append(row());await a.flush();b.append(row('run-a','segment-b'));await b.flush();a.append(row('run-a','segment-a',2));await a.flush();
  const report=await b.export();expect(report.runs[0].events).toHaveLength(3);expect(report.runs[0].segments).toEqual({'segment-a':2,'segment-b':1});expect(report.runs[0].droppedEvents).toBe(0);
});
it('retains only ten recent runs and removes runs older than fourteen days',async()=>{
  const f=fixture(),old=new LogStore(f.open);old.append({...row('old'),at:new Date(NOW-15*86400000).toISOString()});await old.flush();
  const store=new LogStore(f.open);for(let i=0;i<12;i++){vi.setSystemTime(NOW+i);store.append(row('run-'+i));await store.flush();}
  const report=await new LogStore(f.open).export();expect(report.runs).toHaveLength(10);expect(report.runs.map(x=>x.run)).not.toContain('old');expect(report.runs.map(x=>x.run)).not.toContain('run-0');expect(f.data.size).toBe(10);
});
it('bounds repeated retry logs while retaining the beginning, latest events and dropped count',async()=>{
  const f=fixture(),store=new LogStore(f.open);for(let i=1;i<=MAX_EVENTS+7;i++)store.append(row('run-a','segment-a',i));await store.flush();
  const run=(await new LogStore(f.open).export()).runs[0];expect(run.events).toHaveLength(MAX_EVENTS);expect(run.events[0].seq).toBe(1);expect(run.events.at(-1)?.seq).toBe(MAX_EVENTS+7);expect(run.droppedEvents).toBe(7);
});
it('exports memory with a warning after a storage failure and can later retry saving',async()=>{
  const f=fixture();let broken=true;const store=new LogStore(async()=>{if(broken)throw new Error('unavailable');return f.cache;});store.append(row());
  const first=await store.export();expect(first.runs[0].events).toHaveLength(1);expect(first.storageWarning).toBeTruthy();broken=false;await store.export();expect((await new LogStore(f.open).export()).runs[0].events).toHaveLength(1);
});
it('serializes delayed writes without losing events appended during a save',async()=>{
  const f=fixture(),hold=deferred<void>(),put=f.cache.put.bind(f.cache);vi.spyOn(f.cache,'put').mockImplementationOnce(async(key,value)=>{await hold.promise;await put(key,value);});
  const store=new LogStore(f.open);store.append(row());const first=store.flush();store.append(row('run-a','segment-a',2));const second=store.flush();hold.resolve();await Promise.all([first,second]);
  expect((await new LogStore(f.open).export()).runs[0].events).toHaveLength(2);
});
it('uses a separate lock to serialize writers from different pages',async()=>{
  const f=fixture();let tail=Promise.resolve();const request=vi.fn((_name:string,callback:()=>Promise<void>)=>{const next=tail.then(callback);tail=next;return next;});vi.stubGlobal('navigator',{locks:{request}});
  const a=new LogStore(f.open),b=new LogStore(f.open);a.append(row());b.append(row('run-a','segment-b'));await Promise.all([a.flush(),b.flush()]);expect((await new LogStore(f.open).export()).runs[0].events).toHaveLength(2);expect(request).toHaveBeenCalledWith('seu-lecture-helper:logs',expect.any(Function));
});
it('handles a corrupted cached record without preventing export or later saves',async()=>{
  const f=fixture();f.data.set(new URL('/.seu-lecture-helper/logs/run-a.json',location.origin).href,new Response('not json'));const store=new LogStore(f.open);store.append(row());const report=await store.export();expect(report.runs[0].events).toHaveLength(1);expect(report.storageWarning).toBeTruthy();
});
it('keeps the booking outcome when the successful panel is closed or the page leaves',async()=>{
  const f=fixture(),store=new LogStore(f.open);store.append({...row(),event:'状态变化',phase:'success'});store.append({...row('run-a','segment-a',2),event:'状态变化',phase:'closed'});
  expect((await store.export()).runs[0].summary).toMatchObject({phase:'success',lastPhase:'closed'});
});
it('does not resurrect more than ten cached runs when an old page exports again',async()=>{
  const f=fixture(),old=new LogStore(f.open);old.append(row('old'));await old.flush();const fresh=new LogStore(f.open);
  for(let i=0;i<10;i++){vi.setSystemTime(NOW+i+1);fresh.append(row('new-'+i));await fresh.flush();}
  expect(f.data.size).toBe(10);await old.export();expect(f.data.size).toBe(10);
});
it('does not summarize an actively resumed task as its previous login failure',async()=>{
  const f=fixture(),store=new LogStore(f.open);store.append({...row(),event:'状态变化',phase:'login-required'});store.append({...row('run-a','segment-a',2),event:'状态变化',phase:'waiting'});
  expect((await store.export()).runs[0].summary.phase).toBe('waiting');
});
it.each([{events:[null]},{events:[{at:null}]},{events:['bad']}])('rejects structurally corrupted event arrays and still exports current memory (%j)',async({events})=>{
  const f=fixture();f.data.set(new URL('/.seu-lecture-helper/logs/run-a.json',location.origin).href,new Response(JSON.stringify({run:'run-a',startedAt:NOW,updatedAt:NOW,segments:{'segment-a':1},events})));
  const store=new LogStore(f.open);store.append(row());const report=await store.export();expect(report.storageWarning).toBeTruthy();expect(report.runs[0].events).toEqual([row()]);
});
it('exports a warning instead of failing when only structurally corrupted history exists',async()=>{
  const f=fixture();f.data.set(new URL('/.seu-lecture-helper/logs/run-a.json',location.origin).href,new Response(JSON.stringify({run:'run-a',startedAt:NOW,updatedAt:NOW,segments:{'segment-a':1},events:[null]})));
  const report=await new LogStore(f.open).export();expect(report.runs).toEqual([]);expect(report.storageWarning).toBeTruthy();
});
it('keeps credentials and the known captcha out of real API-to-diagnostics JSON export',async()=>{
  const f=fixture();vi.stubGlobal('caches',{open:f.open});const {Diagnostics}=await import('../src/diagnostics'),{Api}=await import('../src/api'),{logStore}=await import('../src/log-store');
  for(const msg of ['验证码错误 code=0733abc','authorization: Bearer SECRET_AUTH','{"token":"SECRET_TOKEN","password":"SECRET_PASSWORD"}']){
    const api=new Api(vi.fn(async()=>new Response(JSON.stringify({code:'token=SECRET_CODE',datas:null,msg}))));
    await new Diagnostics().measure('预约提交',()=>api.submit('id','0733')).catch(()=>{});
  }
  const serialized=JSON.stringify(await logStore.export());expect(serialized).not.toContain('SECRET');expect(serialized).not.toContain('0733');expect(serialized).toContain('预约提交失败');
});
