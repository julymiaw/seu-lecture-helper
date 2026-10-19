import {ApiError, type Activity, type ReservationApi} from './api';
import type {OcrEngine} from './ocr';
import {findCandidates,ordered,classified,mode,type Mode,type Labels} from './candidates';
import {Diagnostics, businessReason, errorInfo} from './diagnostics';
export type Phase = 'choosing' | 'login-required' | 'loading' | 'ready' | 'waiting' | 'captcha-loading' | 'recognizing' | 'prepared' | 'submitting' | 'verifying' | 'success' | 'failed' | 'unknown' | 'closed';
export const CAPTURE_LEAD_MS=30000;
export interface Recovery {leadSeconds?:number;runId?:string;verify:boolean;ids?:string[];index?:number;preferred?:Mode;labels?:Labels}
export interface State {
  fullIds?:string[]; requestedId?:string; candidates?:Activity[]; candidateIndex?:number; preferred?:Mode; labels?:Labels;
  lastFailure?:{target:string;message:string;action:string;reason?:string};
  phase: Phase; message: string; runId?:string; verifiedId?:string; activity?: Activity; offset?: number; remaining?: number;
  image?: string; code?: string; armed?: boolean;
  ocrStatus?: 'loading' | 'ready' | 'failed'; ocrMessage?: string; verifyAfterLogin?:boolean;
}
export function fullCapacity(state: State) {const a=state.activity; return Boolean(a?.countKnown && a.capacity > 0 && a.count >= a.capacity);}
export function controls(state: State, now=Date.now()) {
  const a=state.activity, active=Boolean(a && !a.reserved && !a.cancelled && now+(state.offset??0)<a.endsAt && (!fullCapacity(state) || (state.candidates?.length??0)>1));
  return {start:active && state.phase==='ready' && Boolean(classified(state.candidates??(a?[a]:[]),state.labels)),
    submit:active && state.phase==='prepared' && now+(state.offset??0)>=a!.startsAt && /^\d{4}$/.test(state.code??''),
    close:!['submitting','verifying'].includes(state.phase)};
}
export class Reservation {
  state: State={phase:'closed',message:''};
  private generation=0;
  private ocrEpoch=0;
  private timer?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private wake?: () => void;
  private round=0;
  private submissions=0;
  private preparing?:Promise<boolean>;
  private targetId?:string;
  private recovery?:Recovery;
  private nextSessionCheck=0;
  private sessionChecking=false;
  private expectedTickAt?:number;
  private diagnostics=new Diagnostics();
  private captchaSentAt?:number;
  private captchaReceivedAt?:number;
  private ocrFinishedAt?:number;
  private lastSessionCheckAt?:number;
  constructor(private api:ReservationApi, private publish:(state:State)=>void, private now=Date.now, private ocr:OcrEngine) {}
  private serverNow() {return this.now()+(this.state.offset??0);}
  private valid(g:number) {return g===this.generation && this.state.phase!=='closed';}
  private stage<T>(name:string,operation:()=>Promise<T>,stale=()=>false) {
    const g=this.generation;
    return this.diagnostics.measure(name,operation,{activityId:this.state.activity?.id??this.targetId,candidateMode:this.state.activity?mode(this.state.activity,this.state.labels):undefined,priority:(this.state.candidateIndex??0)+1,round:this.round,submissions:this.submissions},()=>!this.valid(g)||stale());
  }
  private set(phase:Phase,message:string,extra:Partial<State>={}) {
    const from=this.state.phase;
    this.state={...this.state,...extra,phase,message}; this.publish(this.state);
    if(from!==phase)this.diagnostics.record(['failed','unknown','login-required'].includes(phase)?'warn':'log','状态变化',{from,phase,round:this.round,submissions:this.submissions,reason:businessReason(message)});
  }
  private bookable() {
    const a=this.state.activity;
    if(!a)return false;
    if(a.reserved){this.finish('success','该活动已有预约记录');return false;}
    if(a.cancelled || this.serverNow()>=a.endsAt || fullCapacity(this.state) && (this.state.candidates?.length??0)<2) {
      this.stop(a.cancelled?'活动已取消':fullCapacity(this.state)?'当前活动预约人数已满':'预约时间已结束');return false;
    }
    return true;
  }
  private finish(phase:Phase,text:string) {clearTimeout(this.timer);this.set(phase,text,{armed:false,remaining:undefined});}
  private stop(text:string) {++this.ocrEpoch;this.finish('failed',text);}
  private prepareOcr():Promise<boolean> {
    if(this.state.ocrStatus==='ready')return Promise.resolve(true);
    if(this.preparing)return this.preparing;
    const g=this.generation;
    this.set(this.state.phase,this.state.message,{ocrStatus:'loading',ocrMessage:undefined});
    const pending=this.stage('OCR准备与预热',()=>this.ocr.prepare()).then(()=>{
      if(!this.valid(g))return false;
      this.set(this.state.phase,this.state.message,{ocrStatus:'ready',ocrMessage:undefined});return true;
    }).catch(()=>{
      if(this.valid(g))this.set(this.state.phase,this.state.message,{ocrStatus:'failed',ocrMessage:this.state.armed?'OCR 准备失败':'OCR 准备失败，启动时自动重试'});
      return false;
    }).finally(()=>{if(this.preparing===pending)this.preparing=undefined;});
    this.preparing=pending;return pending;
  }
  async open(id:string,recovery?:Recovery) {
    this.targetId=id;this.recovery=recovery;
    const g=++this.generation;
    this.diagnostics=new Diagnostics(recovery?.runId);this.captchaSentAt=undefined;this.captchaReceivedAt=undefined;this.ocrFinishedAt=undefined;this.lastSessionCheckAt=undefined;this.round=0;this.submissions=0;this.preparing=undefined;this.sessionChecking=false;this.expectedTickAt=undefined;
    this.state={phase:'loading',message:'正在获取活动信息',runId:this.diagnostics.run,verifyAfterLogin:recovery?.verify,preferred:recovery?.preferred??'online',labels:recovery?.labels};this.publish(this.state);
    this.diagnostics.record('log','打开任务',{activityId:id,recovered:Boolean(recovery),verifyOnly:Boolean(recovery?.verify)});
    if(recovery?.verify){this.set('unknown','恢复后先核验之前的提交结果');return;}
    try {
      const data=await this.stage('活动查询',()=>this.api.list());
      if(!this.valid(g))return;
      let activity=data.activities.find(a=>a.id===id), offset=data.offset;
      if(!activity){const detail=await this.stage('活动详情查询',()=>this.api.detail(id));activity=detail.activity;offset=detail.offset;}
      if(!this.valid(g))return;
      let candidates:Activity[];
      if(recovery?.ids){candidates=[];for(const candidateId of recovery.ids){let item=data.activities.find(a=>a.id===candidateId);if(!item)item=(await this.stage('候选详情查询',()=>this.api.detail(candidateId))).activity;if(!this.valid(g))return;candidates.push(item);}}
      else candidates=recovery?[activity]:ordered(findCandidates(activity,data.activities),this.state.preferred!,this.state.labels);
      const index=recovery?.index??0;activity=candidates[index];
      if(!activity)throw new ApiError('恢复的候选场次无效','format');
      this.targetId=activity.id;this.state={...this.state,activity,offset,candidates,candidateIndex:index,fullIds:recovery?.ids?.slice(0,index)??[]};
      const bookedIndex=candidates.findIndex(a=>a.reserved);
      if(bookedIndex>=0){this.state={...this.state,activity:candidates[bookedIndex],candidateIndex:bookedIndex};this.targetId=candidates[bookedIndex].id;this.finish('success','该讲座已有预约记录，不再预约另一场次');return;}
      if(!this.bookable())return;
      this.set('ready','');void this.prepareOcr();
    }catch(error){if(this.valid(g)){if(error instanceof ApiError && error.kind==='session')this.requireLogin();else this.stop(message(error));}}
  }
  requestPairChoice(id:string) {if(this.state.phase==='ready' && this.state.candidates?.length===2)this.set('choosing','',{requestedId:id});}
  choosePair(include:boolean) {
    if(this.state.phase!=='choosing')return;
    const id=this.state.requestedId!;this.set('ready','',{requestedId:undefined});if(!include)this.single(id);
  }
  single(id:string) {
    if(this.state.phase!=='ready')return;
    const activity=this.state.candidates?.find(a=>a.id===id);if(!activity)return;
    this.targetId=id;this.set('ready','',{activity,candidates:[activity],candidateIndex:0});
    this.bookable();
  }
  prefer(preferred:Mode,labels:Labels=this.state.labels??{}) {
    if(this.state.phase!=='ready')return;
    const candidates=ordered(this.state.candidates??[],preferred,labels);
    this.targetId=candidates[0]?.id;this.set('ready',classified(candidates,labels)?'':'请将两个候选分别标注为线上和线下',{preferred,labels,candidates,candidateIndex:0,activity:candidates[0]});
  }
  private advanceCandidate() {
    const index=(this.state.candidateIndex??0)+1,next=this.state.candidates?.[index];if(!next)return false;
    ++this.generation;++this.ocrEpoch;clearTimeout(this.timer);clearTimeout(this.retryTimer);this.round=0;this.preparing=undefined;this.sessionChecking=false;this.expectedTickAt=undefined;
    this.targetId=next.id;this.diagnostics.record('warn','满员切换候选',{activityId:this.state.activity?.id,nextActivityId:next.id,priority:index+1});
    this.set('waiting','',{activity:next,candidateIndex:index,image:undefined,code:'',armed:true});this.tick();return true;
  }
  start() {
    if(!controls(this.state,this.now()).start || !this.bookable())return;
    this.nextSessionCheck=this.now()+60000;
    this.set('waiting','',{armed:true});
    this.diagnostics.record('log','启动任务',{leadSeconds:CAPTURE_LEAD_MS/1000,serverOffsetMs:this.state.offset,activityId:this.state.activity?.id,activityTitle:this.state.activity?.title,opensAt:this.state.activity?.startsAt,endsAt:this.state.activity?.endsAt,preferred:this.state.preferred,firstCandidate:this.state.candidates?.[0]?.id,secondCandidate:this.state.candidates?.[1]?.id});
    this.tick();
  }
  private requireLogin() {
    ++this.generation;++this.ocrEpoch;clearTimeout(this.timer);clearTimeout(this.retryTimer);this.wake?.();this.wake=undefined;
    this.set('login-required','登录已失效；登录后恢复任务',{image:undefined,code:'',remaining:undefined,verifyAfterLogin:['submitting','verifying','unknown'].includes(this.state.phase) || this.state.verifyAfterLogin});
  }
  async resume() {
    if(this.state.phase!=='login-required' || !this.targetId)return;
    if(this.state.verifyAfterLogin){await this.restoreVerification();return;}
    const snapshot=this.state,id=this.targetId;
    const recovery:Recovery={runId:this.state.runId,verify:false,ids:this.state.candidates?.map(a=>a.id)??this.recovery?.ids,index:this.state.candidateIndex??this.recovery?.index,preferred:this.state.preferred,labels:this.state.labels};
    await this.open(id,recovery);
    if((this.state as State).phase==='login-required')this.set('login-required',this.state.message,{...snapshot,runId:this.diagnostics.run,armed:Boolean(snapshot.armed)});
    else if((this.state as State).phase==='ready')this.start();
  }
  async restoreVerification() {
    if(!this.targetId || this.state.phase==='closed')return;
    this.set('unknown','恢复后先核验之前的提交结果',{armed:false});await this.verify();
  }
  private async checkSession() {
    const g=this.generation;
    try {
      await this.stage('等待期间登录检查',()=>this.api.captcha());
      if(this.valid(g))this.lastSessionCheckAt=this.now();
    }catch(error){
      if(!this.valid(g))return;
      if(error instanceof ApiError && error.kind==='session')this.requireLogin();
      else if(error instanceof ApiError && error.kind==='rate')this.stop(message(error));
      else this.diagnostics.record('warn','登录检查未确认，保留原定时',{...errorInfo(error)});
    }finally{if(this.valid(g)){this.sessionChecking=false;if(this.state.armed && this.round===0)this.tick();}}
  }
  private tick=()=>{
    clearTimeout(this.timer);
    if(this.expectedTickAt!==undefined && this.now()-this.expectedTickAt>1000)this.diagnostics.record('warn','计时回调延迟',{delayMs:this.now()-this.expectedTickAt,visibility:document.visibilityState});
    if(!this.state.armed || !this.bookable())return;
    const remaining=this.state.activity!.startsAt-this.serverNow();
    this.set(this.state.phase,this.state.message,{remaining:Math.max(0,remaining)});
    if(this.round===0 && !this.sessionChecking && this.now()>=this.nextSessionCheck && remaining>CAPTURE_LEAD_MS+20000){this.nextSessionCheck=this.now()+60000;this.sessionChecking=true;void this.checkSession();}
    if(this.round===0 && !this.sessionChecking && remaining<=CAPTURE_LEAD_MS)void this.loadCaptcha();
    if(remaining<=0){if(controls(this.state,this.now()).submit)void this.submit();return;}
    const delay=Math.min(250,remaining);this.expectedTickAt=this.now()+delay;
    this.timer=setTimeout(this.tick,delay);
  };
  private async loadCaptcha() {
    if(!this.state.armed || this.state.phase!=='waiting' || !this.bookable())return;
    const g=this.generation,epoch=++this.ocrEpoch;
    ++this.round;
    this.diagnostics.record('log','开始取图轮次',{round:this.round,plannedCaptureAt:new Date(this.state.activity!.startsAt-(this.state.offset??0)-CAPTURE_LEAD_MS).toISOString(),captureDelayMs:this.serverNow()-this.state.activity!.startsAt+CAPTURE_LEAD_MS,serverOffsetMs:this.state.offset,afterOpenMs:this.serverNow()-this.state.activity!.startsAt,ocrReady:this.state.ocrStatus==='ready',visibility:document.visibilityState});
    this.set('captcha-loading','正在获取验证码',{image:undefined,code:''});
    for(let attempt=0;attempt<3;attempt++) {
      try {
        this.captchaSentAt=this.now();this.captchaReceivedAt=undefined;this.ocrFinishedAt=undefined;
        const image=await this.stage('验证码获取',()=>this.api.captcha());
        if(!this.valid(g)||epoch!==this.ocrEpoch||!this.bookable())return;
        this.captchaReceivedAt=this.now();
        this.diagnostics.record('log','验证码到达',{round:this.round,requestAttempt:attempt+1,captchaSentAt:this.captchaSentAt,captchaReceivedAt:this.captchaReceivedAt});
        this.set('recognizing','正在识别验证码',{image});
        void this.recognize(image,epoch);
        return;
      }catch(error){
        if(!this.valid(g))return;
        if(error instanceof ApiError && error.kind==='session'){this.requireLogin();return;}
        if(!(error instanceof ApiError)||error.kind!=='network'||attempt===2){this.stop(message(error));return;}
        await this.wait((attempt+1)*1000);
        if(!this.valid(g))return;
      }
    }
  }
  private async recognize(image:string,epoch:number) {
    const g=this.generation;
    const waitedForPrewarm=Boolean(this.preparing);
    let prepared=await this.prepareOcr();
    if(!this.valid(g)||epoch!==this.ocrEpoch||!this.bookable())return;
    if(!prepared && waitedForPrewarm){prepared=await this.prepareOcr();if(!this.valid(g)||epoch!==this.ocrEpoch||!this.bookable())return;}
    if(!prepared){this.stop('OCR 引擎准备失败，预约已停止；详见 Console');return;}
    try {
      const code=(await this.stage('OCR识别',()=>this.ocr.recognize(image),()=>epoch!==this.ocrEpoch)).trim();
      if(!this.valid(g)||epoch!==this.ocrEpoch||!this.bookable())return;
      this.ocrFinishedAt=this.now();
      this.diagnostics.record('log','OCR输出检查',{round:this.round,length:code.length,valid:/^\d{4}$/.test(code),ocrFinishedAt:this.ocrFinishedAt});
      if(!/^\d{4}$/.test(code)){await this.retryCaptcha();return;}
      this.set('prepared','',{code,ocrStatus:'ready'});
      if(this.serverNow()>=this.state.activity!.startsAt)await this.submit();
    }catch{if(this.valid(g)&&epoch===this.ocrEpoch)await this.retryCaptcha();}
  }
  private async retryCaptcha() {
    this.diagnostics.record('warn','验证码重试');
    this.set('waiting','正在更新验证码',{image:undefined,code:''});
    await this.loadCaptcha();
  }
  private async submit() {
    if(!this.bookable() || !controls(this.state,this.now()).submit)return;
    const code=this.state.code!.trim();
    ++this.ocrEpoch;clearTimeout(this.timer);
    const g=this.generation;++this.submissions;
    this.diagnostics.record('log','提交时机',{activityId:this.state.activity!.id,priority:(this.state.candidateIndex??0)+1,attempt:this.submissions,afterOpenMs:this.serverNow()-this.state.activity!.startsAt,captchaSentAt:this.captchaSentAt,captchaReceivedAt:this.captchaReceivedAt,captchaHeldMs:this.captchaReceivedAt===undefined?undefined:this.now()-this.captchaReceivedAt,captchaRequestAgeMs:this.captchaSentAt===undefined?undefined:this.now()-this.captchaSentAt,ocrWaitMs:this.ocrFinishedAt===undefined?undefined:this.now()-this.ocrFinishedAt,lastSessionCheckAt:this.lastSessionCheckAt,sessionCheckAgeMs:this.lastSessionCheckAt===undefined?undefined:this.now()-this.lastSessionCheckAt,visibility:document.visibilityState});
    this.set('submitting','正在提交预约');
    try{await this.stage('预约提交',()=>this.api.submit(this.state.activity!.id,code));this.diagnostics.record('log','服务端报告预约成功',{responseCode:0,responseData:1});}
    catch(error){
      if(!this.valid(g))return;
      const reason=error instanceof ApiError && error.kind==='business'?businessReason(error.message):undefined;
      let action='核验当前预约';
      if(reason==='full')action=(this.state.candidateIndex??0)+1<(this.state.candidates?.length??1)?'切换下一候选':'停止：所有候选已满';
      else if(reason==='captcha-rejected'||reason==='not-open')action='当前场次换图重试';
      else if(error instanceof ApiError && error.kind==='session')action='等待登录恢复';
      else if(error instanceof ApiError && (error.kind==='rate'||error.kind==='business' && reason!=='already-booked'))action='停止';
      this.set(this.state.phase,this.state.message,{fullIds:reason==='full'?[...new Set([...(this.state.fullIds??[]),this.state.activity!.id])]:this.state.fullIds,lastFailure:{reason,target:mode(this.state.activity!,this.state.labels)==='online'?'线上':mode(this.state.activity!,this.state.labels)==='offline'?'线下':this.state.activity!.title,message:message(error),action}});
      this.diagnostics.record('warn','提交处理决定',{activityId:this.state.activity!.id,candidateMode:mode(this.state.activity!,this.state.labels),priority:(this.state.candidateIndex??0)+1,attempt:this.submissions,...errorInfo(error),action});
      if(error instanceof ApiError && error.kind==='session'){this.requireLogin();return;}
      if(error instanceof ApiError && error.kind==='rate'){this.stop(message(error));return;}
      if(error instanceof ApiError && error.kind==='business'){
        if(reason==='full'){if(this.advanceCandidate())return;this.stop((this.state.candidates?.length??0)>1?'两个场次均已满，预约失败':'人数已满，预约失败');return;}
        if(reason==='already-booked'){await this.verify();return;}
        if(reason==='captcha-rejected' || reason==='not-open'){await this.retryCaptcha();return;}
        this.stop(error.message);return;
      }
      this.diagnostics.record('warn','提交结果不明，转入核验',errorInfo(error));
    }
    if(this.valid(g))await this.verify();
  }
  private wait(ms:number){return new Promise<void>(resolve=>{this.wake=resolve;this.retryTimer=setTimeout(()=>{this.wake=undefined;resolve();},ms);});}
  async verify() {
    const id=this.state.activity?.id??this.targetId;
    if (!id || !['submitting', 'unknown', 'verifying'].includes(this.state.phase)) return;
    // Public recheck cannot start a second concurrent verification loop.
    if (this.state.phase === 'verifying') return;
    const g = this.generation;
    this.set('verifying', '正在查询预约记录');
    let detail = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!this.valid(g)) return;
      if (attempt) await this.wait(attempt * 1000);
      if (!this.valid(g)) return;
      try {
        const booked = await this.stage('预约记录核验', () => this.api.booked(id));
        this.diagnostics.record('log', '核验结果', {attempt: attempt + 1, booked});
        if (booked) {if (this.valid(g)) this.set('success', '预约成功，已核验预约记录', {armed:false, remaining:undefined, verifiedId:id, activity: this.state.activity?{...this.state.activity, reserved: true}:undefined}); return;}
        detail = '暂未查到预约记录';
      } catch (error) {
        detail = message(error);
        if(error instanceof ApiError && error.kind==='session'){if(this.valid(g))this.requireLogin();return;}
        if(error instanceof ApiError && error.kind==='rate')break;
      }
    }
    if (this.valid(g)) this.finish('unknown', '结果待确认：' + detail + '。请重新核验，不要直接重复提交。');
  }
  close() {
    if(!controls(this.state,this.now()).close)return false;
    ++this.generation;++this.ocrEpoch;clearTimeout(this.timer);clearTimeout(this.retryTimer);this.wake?.();this.wake=undefined;
    this.set('closed','',{armed:false});return true;
  }
}
export function message(error:unknown){return error instanceof Error?error.message:'操作失败，请稍后重试';}
