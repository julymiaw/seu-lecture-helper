import {ApiError, type Activity, type ReservationApi} from './api';
import type {OcrEngine} from './ocr';
import {findCandidates,ordered,classified,mode,type Mode} from './candidates';
import {Diagnostics, businessReason} from './diagnostics';
export type Phase = 'choosing' | 'login-required' | 'loading' | 'ready' | 'waiting' | 'captcha-loading' | 'recognizing' | 'prepared' | 'submitting' | 'verifying' | 'success' | 'failed' | 'unknown' | 'closed';
export const CAPTURE_LEAD_MS=30000;
export const SUBMIT_DELAY_MS=50;
export interface Recovery {runId?:string;verify:boolean;ids?:string[];index?:number;preferred?:Mode}
export interface State {
  fullIds?:string[]; requestedId?:string; candidates?:Activity[]; candidateIndex?:number; preferred?:Mode;
  phase: Phase; message: string; runId?:string; verifiedId?:string; activity?: Activity; remaining?: number;
  code?: string; armed?: boolean;
  ocrStatus?: 'loading' | 'ready' | 'failed'; verifyAfterLogin?:boolean;
}
export function fullCapacity(state: State) {const a=state.activity; return Boolean(a?.countKnown && a.capacity > 0 && a.count >= a.capacity);}
export function controls(state: State, now=Date.now()) {
  const a=state.activity, active=Boolean(a && !a.reserved && !a.cancelled && now<a.endsAt && (!fullCapacity(state) || (state.candidates?.length??0)>1));
  return {start:active && state.phase==='ready' && Boolean(classified(state.candidates??(a?[a]:[]))),
    submit:active && state.phase==='prepared' && now>=a!.startsAt+SUBMIT_DELAY_MS && /^\d{4}$/.test(state.code??''),
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
  private finalSessionChecked=false;
  private diagnostics=new Diagnostics();
  private captchaReceivedAt?:number;
  private lastSessionCheckAt?:number;
  constructor(private api:ReservationApi, private publish:(state:State)=>void, private now=Date.now, private ocr:OcrEngine) {}
  private valid(g:number) {return g===this.generation && this.state.phase!=='closed';}
  private stage<T>(name:string,operation:()=>Promise<T>,stale=()=>false) {
    const g=this.generation;
    return this.diagnostics.measure(name,operation,{activityId:this.state.activity?.id??this.targetId,round:this.round},()=>!this.valid(g)||stale());
  }
  private set(phase:Phase,message:string,extra:Partial<State>={}) {
    const from=this.state.phase;
    this.state={...this.state,...extra,phase,message}; this.publish(this.state);
    if(from!==phase)this.diagnostics.record(['failed','unknown','login-required'].includes(phase)?'warn':'log','状态变化',{from,phase,round:this.round,submissions:this.submissions,reason:['failed','unknown','login-required'].includes(phase)?businessReason(message):undefined});
  }
  private bookable() {
    const a=this.state.activity;
    if(!a)return false;
    if(a.reserved){this.finish('success','该活动已有预约记录');return false;}
    if(a.cancelled || this.now()>=a.endsAt || fullCapacity(this.state) && (this.state.candidates?.length??0)<2) {
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
    this.set(this.state.phase,this.state.message,{ocrStatus:'loading'});
    const pending=this.stage('OCR准备与预热',()=>this.ocr.prepare()).then(()=>{
      if(!this.valid(g))return false;
      this.set(this.state.phase,this.state.message,{ocrStatus:'ready'});return true;
    }).catch(()=>{
      if(this.valid(g))this.set(this.state.phase,this.state.message,{ocrStatus:'failed'});
      return false;
    }).finally(()=>{if(this.preparing===pending)this.preparing=undefined;});
    this.preparing=pending;return pending;
  }
  async open(id:string,recovery?:Recovery) {
    this.targetId=id;this.recovery=recovery;
    const g=++this.generation;
    this.diagnostics=new Diagnostics(recovery?.runId);
    this.captchaReceivedAt=undefined;
    this.lastSessionCheckAt=undefined;
    this.round=0;
    this.submissions=0;
    this.preparing=undefined;
    this.sessionChecking=false;
    this.expectedTickAt=undefined;
    this.finalSessionChecked=false;
    this.state={phase:'loading',message:'正在获取活动信息',runId:this.diagnostics.run,verifyAfterLogin:recovery?.verify,preferred:recovery?.preferred??'online'};this.publish(this.state);
    this.diagnostics.record('log','打开任务',{activityId:id,recovered:Boolean(recovery),verifyOnly:Boolean(recovery?.verify)});
    if(recovery?.verify){this.set('unknown','恢复后先核验之前的提交结果');return;}
    try {
      const data=await this.stage('活动查询',()=>this.api.list());
      if(!this.valid(g))return;
      let activity=data.activities.find(a=>a.id===id);
      if(!activity){
        const detail=await this.stage('活动详情查询',()=>this.api.detail(id));
        if(!this.valid(g))return;
        activity=detail.activity;
      }
      let candidates:Activity[];
      if(recovery?.ids){
        candidates=[];
        for(const candidateId of recovery.ids){
          let item=data.activities.find(a=>a.id===candidateId);
          if(!item)item=(await this.stage('候选详情查询',()=>this.api.detail(candidateId))).activity;
          if(!this.valid(g))return;
          candidates.push(item);
        }
      }
      else candidates=recovery?[activity]:ordered(findCandidates(activity,data.activities),this.state.preferred!);
      let index=recovery?.index??0;activity=candidates[index];
      if(!activity)throw new ApiError('恢复的候选场次无效','format');
      const bookedIndex=candidates.findIndex(a=>a.reserved);
      if(bookedIndex>=0){index=bookedIndex;activity=candidates[index];}
      else {
        const available=[...data.activities,...candidates.filter(item=>!data.activities.some(a=>a.id===item.id))];
        const matches=findCandidates(activity,available);
        if(!classified(candidates)||candidates.length===2&&(matches.length!==2||!candidates.every(a=>matches.some(b=>a.id===b.id)))){
          this.diagnostics.record('warn','候选配对失效，仅恢复当前目标',{activityId:activity.id});candidates=[activity];index=0;
        }
      }
      this.targetId=activity.id;this.state={...this.state,activity,candidates,candidateIndex:index,fullIds:candidates.length>1?recovery?.ids?.slice(0,index)??[]:[]};
      if(bookedIndex>=0){this.finish('success','该讲座已有预约记录，不再预约另一场次');return;}
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
  prefer(preferred:Mode) {
    if(this.state.phase!=='ready')return;
    const candidates=ordered(this.state.candidates??[],preferred);
    this.targetId=candidates[0]?.id;this.set('ready','',{preferred,candidates,candidateIndex:0,activity:candidates[0]});
  }
  private advanceCandidate() {
    const index=(this.state.candidateIndex??0)+1,next=this.state.candidates?.[index];if(!next)return false;
    ++this.generation;++this.ocrEpoch;clearTimeout(this.timer);clearTimeout(this.retryTimer);this.round=0;this.preparing=undefined;this.sessionChecking=false;this.expectedTickAt=undefined;
    this.targetId=next.id;this.diagnostics.record('warn','满员切换候选',{activityId:this.state.activity?.id,nextActivityId:next.id,priority:index+1});
    this.set('waiting','',{activity:next,candidateIndex:index,code:'',armed:true});this.tick();return true;
  }
  start() {
    if(!controls(this.state,this.now()).start || !this.bookable())return;
    this.nextSessionCheck=this.now()+60000;
    this.set('waiting','',{armed:true});
    this.diagnostics.record('log','启动任务',{timingBasis:'local',submitDelayMs:SUBMIT_DELAY_MS,plannedLocalSubmitAt:new Date(this.state.activity!.startsAt+SUBMIT_DELAY_MS).toISOString(),leadSeconds:CAPTURE_LEAD_MS/1000,activityId:this.state.activity?.id,activityTitle:this.state.activity?.title,opensAt:this.state.activity?.startsAt,endsAt:this.state.activity?.endsAt,preferred:this.state.preferred,firstCandidate:this.state.candidates?.[0]?.id,secondCandidate:this.state.candidates?.[1]?.id});
    this.tick();
  }
  private requireLogin() {
    ++this.generation;++this.ocrEpoch;clearTimeout(this.timer);clearTimeout(this.retryTimer);this.wake?.();this.wake=undefined;
    this.set('login-required','登录已失效；登录后恢复任务',{code:'',remaining:undefined,verifyAfterLogin:['submitting','verifying','unknown'].includes(this.state.phase) || this.state.verifyAfterLogin});
  }
  async resume() {
    if(this.state.phase!=='login-required' || !this.targetId)return;
    if(this.state.verifyAfterLogin){await this.restoreVerification();return;}
    const snapshot=this.state,id=this.targetId;
    const recovery:Recovery={runId:this.state.runId,verify:false,ids:this.state.candidates?.map(a=>a.id)??this.recovery?.ids,index:this.state.candidateIndex??this.recovery?.index,preferred:this.state.preferred};
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
      await this.stage('等待期间登录检查',()=>this.api.detail(this.state.activity!.id),()=>this.round>0);
      if(!this.valid(g)||!this.state.armed||this.round>0)return;
      this.lastSessionCheckAt=this.now();
    }catch(error){
      if(!this.valid(g)||!this.state.armed||this.round>0)return;
      if(error instanceof ApiError && error.kind==='session')this.requireLogin();
      else if(error instanceof ApiError && error.kind==='rate')this.stop(message(error));
    }finally{if(this.valid(g)){this.sessionChecking=false;if(this.state.armed && this.round===0)this.tick();}}
  }
  private tick=()=>{
    clearTimeout(this.timer);
    if(this.expectedTickAt!==undefined && this.now()-this.expectedTickAt>1000)this.diagnostics.record('warn','计时回调延迟',{delayMs:this.now()-this.expectedTickAt,visibility:document.visibilityState});
    if(!this.state.armed || !this.bookable())return;
    const remaining=this.state.activity!.startsAt-this.now();
    this.set(this.state.phase,this.state.message,{remaining:Math.max(0,remaining)});
    if(this.round===0 && !this.sessionChecking && remaining>CAPTURE_LEAD_MS){
      const final=remaining<=40000&&!this.finalSessionChecked;
      if(final || remaining>40000&&this.now()>=this.nextSessionCheck){
        if(final)this.finalSessionChecked=true;
        this.nextSessionCheck=this.now()+60000;
        this.sessionChecking=true;
        void this.checkSession();
      }
    }
    if(this.round===0 && remaining<=CAPTURE_LEAD_MS)void this.loadCaptcha();
    const untilSubmit=remaining+SUBMIT_DELAY_MS;
    if(untilSubmit<=0){if(controls(this.state,this.now()).submit)void this.submit();return;}
    const delay=Math.min(250,untilSubmit);this.expectedTickAt=this.now()+delay;
    this.timer=setTimeout(this.tick,delay);
  };
  private async loadCaptcha() {
    if(!this.state.armed || this.state.phase!=='waiting' || !this.bookable())return;
    const g=this.generation,epoch=++this.ocrEpoch;
    ++this.round;
    this.diagnostics.record('log','开始取图轮次',{round:this.round,plannedLocalCaptureAt:new Date(this.state.activity!.startsAt-CAPTURE_LEAD_MS).toISOString(),captureDelayMs:this.now()-this.state.activity!.startsAt+CAPTURE_LEAD_MS,afterOpenMs:this.now()-this.state.activity!.startsAt,ocrReady:this.state.ocrStatus==='ready',visibility:document.visibilityState});
    this.set('captcha-loading','正在获取验证码',{code:''});
    for(let attempt=0;attempt<3;attempt++) {
      try {
        this.captchaReceivedAt=undefined;
        const image=await this.stage('验证码获取',()=>this.api.captcha());
        if(!this.valid(g)||epoch!==this.ocrEpoch||!this.bookable())return;
        this.captchaReceivedAt=this.now();
        this.set('recognizing','正在识别验证码');
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
    if(!prepared){this.stop('OCR 引擎准备失败，预约已停止');return;}
    try {
      const code=(await this.stage('OCR识别',()=>this.ocr.recognize(image),()=>epoch!==this.ocrEpoch)).trim();
      if(!this.valid(g)||epoch!==this.ocrEpoch||!this.bookable())return;
      if(!/^\d{4}$/.test(code)){await this.retryCaptcha('OCR 输出不是四位数字');return;}
      this.set('prepared','',{code,ocrStatus:'ready'});
      if(this.now()>=this.state.activity!.startsAt+SUBMIT_DELAY_MS)await this.submit();
    }catch{if(this.valid(g)&&epoch===this.ocrEpoch)await this.retryCaptcha('OCR 识别失败');}
  }
  private async retryCaptcha(reason?:string) {
    if(reason)this.diagnostics.record('warn','验证码重试',{reason,round:this.round});
    this.set('waiting','正在更新验证码',{code:''});
    await this.loadCaptcha();
  }
  private async submit() {
    if(!this.bookable() || !controls(this.state,this.now()).submit)return;
    const code=this.state.code!.trim();
    ++this.ocrEpoch;clearTimeout(this.timer);
    const g=this.generation;++this.submissions;
    this.diagnostics.record('log','提交时机',{
      activityId:this.state.activity!.id,
      priority:(this.state.candidateIndex??0)+1,
      attempt:this.submissions,
      afterOpenMs:this.now()-this.state.activity!.startsAt,
      captchaHeldMs:this.captchaReceivedAt===undefined?undefined:this.now()-this.captchaReceivedAt,
      dispatchLateMs:this.now()-this.state.activity!.startsAt-SUBMIT_DELAY_MS,
      sessionCheckAgeMs:this.lastSessionCheckAt===undefined?undefined:this.now()-this.lastSessionCheckAt,
      visibility:document.visibilityState,
    });
    this.set('submitting','正在提交预约');
    try{await this.stage('预约提交',()=>this.api.submit(this.state.activity!.id,code));}
    catch(error){
      if(!this.valid(g))return;
      const reason=error instanceof ApiError && error.kind==='business'?businessReason(error.message):undefined;
      const recordDecision=(action:string)=>this.diagnostics.record('warn','提交处理决定',{
        activityId:this.state.activity!.id,
        candidateMode:mode(this.state.activity!),
        priority:(this.state.candidateIndex??0)+1,
        attempt:this.submissions,
        action,
      });
      if(error instanceof ApiError && error.kind==='session'){
        recordDecision('等待登录恢复');
        this.requireLogin();return;
      }
      if(error instanceof ApiError && error.kind==='rate'){
        recordDecision('停止');
        this.stop(message(error));return;
      }
      if(error instanceof ApiError && error.kind==='business'){
        if(reason==='full'){
          this.set(this.state.phase,this.state.message,{fullIds:[...new Set([...(this.state.fullIds??[]),this.state.activity!.id])]});
          if(this.state.candidates?.[(this.state.candidateIndex??0)+1]){
            recordDecision('切换下一候选');
            this.advanceCandidate();return;
          }
          recordDecision('停止：所有候选已满');
          this.stop((this.state.candidates?.length??0)>1?'两个场次均已满，预约失败':'人数已满，预约失败');return;
        }
        if(reason==='already-booked'){
          recordDecision('核验当前预约');
          await this.verify();return;
        }
        if(reason==='captcha-rejected' || reason==='not-open'){
          recordDecision('当前场次换图重试');
          await this.retryCaptcha();return;
        }
        recordDecision('停止');
        this.stop(error.message);return;
      }
      recordDecision('核验当前预约');
    }
    if(this.valid(g))await this.verify();
  }
  private wait(ms:number){return new Promise<void>(resolve=>{this.wake=resolve;this.retryTimer=setTimeout(()=>{this.wake=undefined;resolve();},ms);});}
  async verify() {
    const id=this.state.activity?.id??this.targetId;
    // Only a submitted or unresolved task may start a verification loop.
    if (!id || !['submitting', 'unknown'].includes(this.state.phase)) return;
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
