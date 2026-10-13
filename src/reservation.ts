import {ApiError, type Activity, type ReservationApi} from './api';
import type {OcrEngine} from './ocr';
import {Diagnostics, businessReason, errorInfo} from './diagnostics';
export type Phase = 'loading' | 'ready' | 'waiting' | 'captcha-loading' | 'recognizing' | 'input' | 'submitting' | 'verifying' | 'success' | 'failed' | 'unknown' | 'closed';
export interface State {
  phase: Phase; message: string; activity?: Activity; offset?: number; remaining?: number;
  image?: string; code?: string; leadSeconds?: number; armed?: boolean;
  ocrStatus?: 'loading' | 'ready' | 'failed'; ocrMessage?: string;
}
export function fullCapacity(state: State) {const a=state.activity; return Boolean(a?.countKnown && a.capacity > 0 && a.count >= a.capacity);}
export function controls(state: State, now=Date.now()) {
  const a=state.activity, active=Boolean(a && !a.reserved && !a.cancelled && now+(state.offset??0)<a.endsAt && !fullCapacity(state));
  const editable=active && ['waiting','input','recognizing'].includes(state.phase) && Boolean(state.image);
  return {start:active && state.phase==='ready', edit:editable, refresh:editable,
    submit:editable && now+(state.offset??0)>=a!.startsAt && /^\d{4}$/.test(state.code??''),
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
  private incomplete=false;
  private diagnostics=new Diagnostics();
  constructor(private api:ReservationApi, private publish:(state:State)=>void, private now=Date.now, private ocr?:OcrEngine) {}
  private serverNow() {return this.now()+(this.state.offset??0);}
  private valid(g:number) {return g===this.generation && this.state.phase!=='closed';}
  private stage<T>(name:string,operation:()=>Promise<T>,stale=()=>false) {
    const g=this.generation;
    return this.diagnostics.measure(name,operation,{round:this.round,submissions:this.submissions},()=>!this.valid(g)||stale());
  }
  private set(phase:Phase,message:string,extra:Partial<State>={}) {
    const from=this.state.phase;
    this.state={...this.state,...extra,phase,message}; this.publish(this.state);
    if(from!==phase)this.diagnostics.record(['failed','unknown'].includes(phase)?'warn':'log','状态变化',{from,phase,round:this.round,submissions:this.submissions,reason:businessReason(message)});
  }
  private bookable() {
    const a=this.state.activity;
    if(!a)return false;
    if(a.reserved){this.finish('success','该活动已有预约记录');return false;}
    if(a.cancelled || this.serverNow()>=a.endsAt || fullCapacity(this.state)) {
      this.stop(a.cancelled?'活动已取消':fullCapacity(this.state)?'当前活动预约人数已满':'预约时间已结束');return false;
    }
    return true;
  }
  private finish(phase:Phase,text:string) {clearTimeout(this.timer);this.set(phase,text,{armed:false,remaining:undefined});}
  private stop(text:string) {++this.ocrEpoch;this.finish('failed',text);}
  private async prepareOcr() {
    const g=this.generation;
    this.set(this.state.phase,this.state.message,{ocrStatus:'loading'});
    try {
      if(!this.ocr)throw new Error('本地识别不可用');
      await this.stage('OCR准备与预热',()=>this.ocr!.prepare());
      if(this.valid(g))this.set(this.state.phase,this.state.message,{ocrStatus:'ready',ocrMessage:undefined});
    }catch(error){if(this.valid(g))this.set(this.state.phase,this.state.message,{ocrStatus:'failed',ocrMessage:'识别引擎不可用，请填写验证码'});}
  }
  async open(id:string) {
    const g=++this.generation;
    this.diagnostics=new Diagnostics();this.round=0;this.submissions=0;this.incomplete=false;
    this.state={phase:'loading',message:'正在获取活动信息',leadSeconds:30};this.publish(this.state);
    this.diagnostics.record('log','打开任务',{activityId:id});
    try {
      const data=await this.stage('活动查询',()=>this.api.list());
      if(!this.valid(g))return;
      let activity=data.activities.find(a=>a.id===id), offset=data.offset;
      if(!activity){const detail=await this.stage('活动详情查询',()=>this.api.detail(id));activity=detail.activity;offset=detail.offset;}
      if(!this.valid(g))return;
      this.state={...this.state,activity,offset};
      if(!this.bookable())return;
      this.set('ready','');void this.prepareOcr();
    }catch(error){if(this.valid(g))this.stop(message(error));}
  }
  configure(leadSeconds:number) {
    if(this.state.phase==='ready' && [10,20,30,60].includes(leadSeconds))this.set('ready','',{leadSeconds});
  }
  start() {
    if(!controls(this.state,this.now()).start || !this.bookable())return;
    this.set('waiting','',{armed:true});
    this.diagnostics.record('log','启动任务',{leadSeconds:this.state.leadSeconds,serverOffsetMs:this.state.offset});
    this.tick();
  }
  private tick=()=>{
    clearTimeout(this.timer);
    if(!this.state.armed || !this.bookable())return;
    const remaining=this.state.activity!.startsAt-this.serverNow();
    this.set(this.state.phase,this.state.message,{remaining:Math.max(0,remaining)});
    if(this.round===0 && remaining<=(this.state.leadSeconds??30)*1000)void this.loadCaptcha();
    if(remaining<=0){if(controls(this.state,this.now()).submit)void this.submit();else if(this.incomplete)void this.retryCaptcha();return;}
    this.timer=setTimeout(this.tick,Math.min(250,remaining));
  };
  editCode(code:string) {
    if(!controls(this.state,this.now()).edit)return;
    ++this.ocrEpoch; // A late OCR result must never overwrite a user's correction.
    this.set('input','',{code:code.replace(/\D/g,'').slice(0,4)});
    this.diagnostics.record('log','人工修改验证码');
  }
  async loadCaptcha() {
    if(!this.state.armed || !['waiting','input','recognizing'].includes(this.state.phase) || !this.bookable())return;
    const g=this.generation,epoch=++this.ocrEpoch;
    this.incomplete=false;
    ++this.round;
    this.diagnostics.record('log','开始取图轮次',{round:this.round,afterOpenMs:this.serverNow()-this.state.activity!.startsAt,ocrReady:this.state.ocrStatus==='ready',visibility:document.visibilityState});
    this.set('captcha-loading','正在获取验证码',{image:undefined,code:''});
    for(let attempt=0;attempt<3;attempt++) {
      try {
        const image=await this.stage('验证码获取',()=>this.api.captcha());
        if(!this.valid(g)||epoch!==this.ocrEpoch)return;
        this.set('input','',{image});
        if(this.state.ocrStatus!=='failed' && this.ocr)void this.recognize(image,epoch);
        return;
      }catch(error){
        if(!this.valid(g))return;
        if(!(error instanceof ApiError)||error.kind!=='network'||attempt===2){this.stop(message(error));return;}
        await this.wait((attempt+1)*1000);
        if(!this.valid(g))return;
      }
    }
  }
  private async recognize(image:string,epoch:number) {
    const g=this.generation;
    this.set('recognizing','正在识别验证码');
    try {
      const code=(await this.stage('OCR识别',()=>this.ocr!.recognize(image),()=>epoch!==this.ocrEpoch)).trim();
      if(!this.valid(g)||epoch!==this.ocrEpoch)return;
      this.diagnostics.record('log','OCR输出检查',{length:code.length,valid:/^\d{4}$/.test(code)});
      if(!/^\d{4}$/.test(code)){await this.ocrFailed();return;}
      this.set('input','',{code});
      if(this.serverNow()>=this.state.activity!.startsAt)await this.submit();
    }catch{if(this.valid(g)&&epoch===this.ocrEpoch)await this.ocrFailed();}
  }
  private async ocrFailed() {
    if(this.state.ocrStatus==='failed'){this.set('input','识别引擎不可用，请填写验证码');return;}
    if(this.serverNow()<this.state.activity!.startsAt) {
      // Keep the image editable; do not churn CAPTCHA challenges before opening.
      this.set('input','识别失败，可修改验证码；开放后自动换图重试');
      this.incomplete=true;
      return;
    }
    await this.retryCaptcha();
  }
  private async retryCaptcha() {
    this.diagnostics.record('warn','验证码重试');
    this.set('input','正在更新验证码',{image:undefined,code:''});
    await this.loadCaptcha();
  }
  async submit() {
    if(!controls(this.state,this.now()).submit || !this.bookable())return;
    const code=this.state.code!.trim();
    ++this.ocrEpoch;clearTimeout(this.timer);
    const g=this.generation;++this.submissions;
    this.diagnostics.record('log','提交时机',{afterOpenMs:this.serverNow()-this.state.activity!.startsAt});
    this.set('submitting','正在提交预约');
    try{await this.stage('预约提交',()=>this.api.submit(this.state.activity!.id,code));this.diagnostics.record('log','服务端报告预约成功',{responseCode:0,responseData:1});}
    catch(error){
      if(!this.valid(g))return;
      if(error instanceof ApiError && ['session','rate'].includes(error.kind)){this.stop(message(error));return;}
      if(error instanceof ApiError && error.kind==='business'){
        const reason=businessReason(error.message);
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
    if (!this.state.activity || !['submitting', 'unknown', 'verifying'].includes(this.state.phase)) return;
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
        const booked = await this.stage('预约记录核验', () => this.api.booked(this.state.activity!.id));
        this.diagnostics.record('log', '核验结果', {attempt: attempt + 1, booked});
        if (booked) {if (this.valid(g)) this.set('success', '预约成功，已核验预约记录', {armed:false, remaining:undefined, activity: {...this.state.activity, reserved: true}}); return;}
        detail = '暂未查到预约记录';
      } catch (error) {
        detail = message(error);
        if (error instanceof ApiError && ['session', 'rate'].includes(error.kind)) break;
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
