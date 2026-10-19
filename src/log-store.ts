// JSON history is separate from OCR assets. Storage is never awaited by booking.
export const LOG_CACHE='seu-lecture-diagnostics-v1';
export const MAX_EVENTS=2000;
const KEEP_HEAD=50, MAX_RUNS=10, MAX_AGE=14*86400000;
export interface LogEntry {
  run:string; task:string; seq:number; at:string; version:string; level:string; event:string;
  [key:string]:string|number|boolean|undefined;
}
export interface RunLog {run:string;startedAt:number;updatedAt:number;segments:Record<string,number>;events:LogEntry[];droppedEvents:number}
function summarize(run:RunLog) {
  const start=run.events.find(e=>e.event==='启动任务');
  const states=[...run.events].reverse().filter(e=>e.event==='状态变化');
  const last=states[0],previous=states.find(e=>e.phase!=='closed');
  const phase=last?.phase==='closed'&&['success','failed','unknown','login-required'].includes(String(previous?.phase))?previous?.phase:last?.phase;
  return {...run,summary:{activityTitle:start?.activityTitle,activityId:start?.activityId,phase,lastPhase:last?.phase,droppedEvents:run.droppedEvents}};
}
function merge(a:RunLog|undefined,b:RunLog):RunLog {
  const segments={...a?.segments};for(const [id,count] of Object.entries(b.segments))segments[id]=Math.max(segments[id]??0,count);
  const rows=new Map<string,LogEntry>();for(const row of [...a?.events??[],...b.events])rows.set(row.task+':'+row.seq,row);
  let events=[...rows.values()].sort((x,y)=>x.at.localeCompare(y.at)||x.task.localeCompare(y.task)||x.seq-y.seq);
  if(events.length>MAX_EVENTS)events=[...events.slice(0,KEEP_HEAD),...events.slice(-(MAX_EVENTS-KEEP_HEAD))];
  return {run:b.run,startedAt:Math.min(a?.startedAt??b.startedAt,b.startedAt),updatedAt:Math.max(a?.updatedAt??0,b.updatedAt),segments,events,droppedEvents:Object.values(segments).reduce((n,x)=>n+x,0)-events.length};
}
export class LogStore {
  private memory=new Map<string,RunLog>();
  private dirty=new Set<string>();
  private timer?:ReturnType<typeof setTimeout>;
  private queue:Promise<void>=Promise.resolve();
  private storageFailed=false;
  private cleaned=new Set<string>();
  constructor(private openCache=()=>caches.open(LOG_CACHE),private now=Date.now) {}
  private key(run:string){return new URL('/.seu-lecture-helper/logs/'+encodeURIComponent(run)+'.json',location.origin).href;}
  append(entry:LogEntry) {
    const at=Date.parse(entry.at),row={...entry};
    const old=this.memory.get(entry.run);let events=[...old?.events??[],row];
    if(events.length>MAX_EVENTS)events=[...events.slice(0,KEEP_HEAD),...events.slice(-(MAX_EVENTS-KEEP_HEAD))];
    const segments={...old?.segments,[entry.task]:entry.seq};
    const next={run:entry.run,startedAt:old?.startedAt??at,updatedAt:at,segments,events,droppedEvents:Object.values(segments).reduce((n,x)=>n+x,0)-events.length};
    this.memory.set(entry.run,next);this.dirty.add(entry.run);
    const recent=[...this.memory.values()].sort((a,b)=>b.updatedAt-a.updatedAt);
    for(const run of recent.slice(MAX_RUNS)){this.memory.delete(run.run);this.dirty.delete(run.run);}
    if(this.timer===undefined)this.timer=setTimeout(()=>{this.timer=undefined;void this.flush();},500);
  }
  private async read(cache:Cache,key:RequestInfo):Promise<RunLog|undefined>{
    const response=await cache.match(key);if(!response)return;
    const value=await response.json();
    if(value && typeof value.run==='string' && Number.isFinite(value.updatedAt) && Number.isFinite(value.startedAt) && Array.isArray(value.events) && value.segments && typeof value.segments==='object' && !Array.isArray(value.segments)
      && Object.values(value.segments).every(n=>Number.isInteger(n)&&Number(n)>=0)
      && value.events.every((row:LogEntry)=>row && row.run===value.run && typeof row.task==='string' && typeof row.at==='string' && Number.isFinite(Date.parse(row.at)) && Number.isInteger(row.seq) && row.seq>0 && row.seq<=value.segments[row.task] && typeof row.event==='string'))return value;
    throw new Error('invalid local log');
  }
  private async prune(cache:Cache) {
    const rows=[];
    for(const key of await cache.keys())try{const value=await this.read(cache,key);if(value)rows.push({key,value});}catch{await cache.delete(key);}
    rows.sort((a,b)=>b.value.updatedAt-a.value.updatedAt);
    for(const [i,row] of rows.entries())if(i>=MAX_RUNS||row.value.updatedAt<this.now()-MAX_AGE)await cache.delete(row.key);
  }
  flush():Promise<void> {
    clearTimeout(this.timer);this.timer=undefined;
    const batch=[...this.dirty].map(id=>this.memory.get(id)!).filter(Boolean);this.dirty.clear();
    if(!batch.length)return this.queue;
    const operation=async()=>{
      try {
        const cache=await this.openCache();
        for(const snapshot of batch){
          let previous:RunLog|undefined;try{previous=await this.read(cache,this.key(snapshot.run));}catch{this.storageFailed=true;}
          const combined=merge(previous,snapshot);
          await cache.put(this.key(snapshot.run),new Response(JSON.stringify(combined),{headers:{'Content-Type':'application/json'}}));
          const current=this.memory.get(snapshot.run);if(current)this.memory.set(snapshot.run,merge(combined,current));
          if(!previous||!this.cleaned.has(snapshot.run)){await this.prune(cache);this.cleaned.add(snapshot.run);}
        }
      } catch {this.storageFailed=true;for(const snapshot of batch)if(this.memory.has(snapshot.run))this.dirty.add(snapshot.run);}
    };
    // A separate Web Lock serializes read/merge/write across page reloads/tabs.
    this.queue=this.queue.then(async()=>{if(navigator.locks)await navigator.locks.request('seu-lecture-helper:logs',async()=>{await operation();});else await operation();}).catch(()=>{this.storageFailed=true;for(const snapshot of batch)if(this.memory.has(snapshot.run))this.dirty.add(snapshot.run);});
    return this.queue;
  }
  async export() {
    for(const id of this.memory.keys())this.dirty.add(id);await this.flush();
    const runs=new Map<string,RunLog>();
    try{const cache=await this.openCache();for(const key of await cache.keys())try{const value=await this.read(cache,key);if(value)runs.set(value.run,value);}catch{this.storageFailed=true;}}catch{this.storageFailed=true;}
    for(const [id,value] of this.memory)runs.set(id,merge(runs.get(id),value));
    return {schema:1,exportedAt:new Date(this.now()).toISOString(),storageWarning:this.storageFailed?'本地日志缓存曾读写失败，部分历史可能缺失；包含当前内存记录。':undefined,runs:[...runs.values()].filter(x=>x.updatedAt>=this.now()-MAX_AGE).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,MAX_RUNS).map(summarize)};
  }
}
export const logStore=new LogStore();
export async function downloadLogs() {
  const report=await logStore.export();
  const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='seu-lecture-logs-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  return report.storageWarning;
}
