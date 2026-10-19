import {mode,type Mode} from './candidates';
import {controls,type State} from './reservation';
export interface Actions {
  choosePair(include:boolean):void;
  prefer(preferred:Mode):void;
  verify():void;
  close():void;
  start():void;
  exportLogs():Promise<void>;
  hide():void;
  reload():void;
  login():void;
  resume():void;
}
export function duration(ms:number) {
  const seconds=Math.max(0,Math.ceil(ms/1000));
  return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(x=>String(x).padStart(2,'0')).join(':');
}
function progress(state:State):string {
  if(state.phase==='ready'&&state.ocrStatus==='failed')return '引擎预热失败，启动时重试';
  if(state.phase==='waiting'&&state.ocrStatus==='failed')return '引擎预热失败，取图时重试';
  switch(state.phase) {
    case 'ready':return '待开始';
    case 'waiting':case 'prepared':return '等待开放';
    case 'captcha-loading':case 'recognizing':return '准备中';
    case 'submitting':return '提交中';
    case 'verifying':return '核验中';
    case 'success':return '预约成功';
    case 'unknown':return state.message||'结果待确认';
    case 'login-required':return '登录已失效';
    default:return state.message;
  }
}
export class Dialog {
  readonly host=document.createElement('div');
  readonly root=this.host.attachShadow({mode:'open'});
  private panel:HTMLDialogElement;
  private candidateSignature='';
  private exporting=false;
  private phase?:State['phase'];
  constructor(actions:Actions) {
    this.host.id='seu-lecture-helper-dialog';
    this.root.innerHTML=`
<style>
:host{all:initial;font-family:system-ui,"Microsoft YaHei",sans-serif;color:#18251e}
*{box-sizing:border-box}
dialog{width:min(620px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;border:1px solid #dfe8e2;border-radius:18px;padding:24px;background:white;color:inherit;box-shadow:0 24px 80px #10251c30}
dialog::backdrop{background:#10251c80}
h2{font-size:18px;line-height:1.5;margin:0 0 18px;overflow-wrap:anywhere}
p{margin:10px 0 0;font-size:13px;line-height:1.5}
#pair-question{font-size:14px;color:#64776a;margin:0}
#candidates{margin-bottom:14px}
#candidates[data-paired=true]{display:grid;grid-template-columns:210px 1fr;align-items:center;gap:12px}
.priority{display:flex;gap:4px;background:#eef3ef;border-radius:10px;padding:4px}
.priority button{flex:1;border:0;background:transparent}
.priority button:disabled{opacity:1;color:#829087}
.priority button[aria-pressed=true]{background:white;box-shadow:0 1px 5px #15372015;color:#287547;font-weight:600}
ol{padding:0;margin:0;list-style:none;font-size:13px;color:#68786d}
li{padding:3px 0;overflow-wrap:anywhere}
li.active,li.success{color:#24663b;font-weight:600}
li.full,li.failed{color:#a25f50}
li.full .candidate-name{text-decoration:line-through;opacity:.8}
.candidate-status{margin-left:8px;font-weight:600}
.overview{display:flex;justify-content:center;align-items:center;background:#f0f7f2;border-radius:12px;padding:14px 16px}
.clock{font-size:32px;font-weight:650;color:#287547;font-variant-numeric:tabular-nums}
.actions{display:flex;justify-content:flex-end;gap:8px;align-items:center;margin-top:18px;flex-wrap:wrap}
#export{margin-right:auto}
button{font:14px system-ui;min-height:38px;padding:7px 13px;border:1px solid #ccd8cf;border-radius:8px;background:white;color:#203e2d;cursor:pointer}
button.primary{background:#287547;border-color:#287547;color:white}
button:disabled{opacity:.5;cursor:default}
[hidden]{display:none!important}
@media(max-width:420px){
  #candidates[data-paired=true]{grid-template-columns:1fr;gap:5px}
  dialog{padding:18px}.clock{font-size:25px}.overview{padding:12px}
}
</style>
<dialog aria-labelledby="title">
  <h2 id="title">讲座预约</h2>
  <p id="pair-question" hidden>是否将同一讲座的另一场次也加入候选？</p>
  <section id="candidates" hidden>
    <div class="priority" role="group" aria-label="候选顺序">
      <button type="button" id="online-first" aria-pressed="true">线上优先</button>
      <button type="button" id="offline-first" aria-pressed="false">线下优先</button>
    </div>
    <ol aria-label="候选场次" aria-live="polite"></ol>
  </section>
  <div class="overview"><span class="clock" aria-label="距离预约开放">--:--:--</span></div>
  <p id="status" role="status" aria-live="polite"></p>
  <div class="actions">
    <button type="button" id="export">导出日志</button>
    <button type="button" id="single" hidden>取消</button>
    <button type="button" id="join" class="primary" hidden>加入</button>
    <button type="button" id="start" class="primary">开始等待</button>
    <button type="button" id="login" hidden>重新登录</button>
    <button type="button" id="resume" hidden>登录后恢复</button>
    <button type="button" id="verify" hidden>重新核验</button>
    <button type="button" id="reload" hidden>刷新学校页面</button>
    <button type="button" id="hide">收起</button>
    <button type="button" id="close">关闭</button>
  </div>
</dialog>`;
    this.panel=this.get('dialog');
    this.get('#online-first').addEventListener('click',()=>actions.prefer('online'));
    this.get('#offline-first').addEventListener('click',()=>actions.prefer('offline'));
    this.get('#single').addEventListener('click',()=>actions.choosePair(false));
    this.get('#join').addEventListener('click',()=>actions.choosePair(true));
    this.get<HTMLButtonElement>('#export').addEventListener('click',async()=>{
      if(this.exporting)return;
      const button=this.get<HTMLButtonElement>('#export');
      this.exporting=true;button.disabled=true;
      try{await actions.exportLogs();}
      finally{this.exporting=false;button.disabled=this.phase==='submitting'||this.phase==='verifying';}
    });
    for(const id of ['start','verify','reload','hide','close','login','resume'] as const)this.get('#'+id).addEventListener('click',()=>actions[id]());
    this.panel.addEventListener('cancel',e=>{e.preventDefault();actions.close();});
    document.body.append(this.host);this.show();
  }
  private get<T extends HTMLElement>(selector:string){return this.root.querySelector<T>(selector)!;}
  show(){if(!this.panel.open)this.panel.showModal();}
  hide(){this.panel.close();}
  destroy(){this.panel.close();this.host.remove();}
  render(state:State) {
    this.phase=state.phase;
    const allowed=controls(state);
    const candidates=state.candidates??(state.activity?[state.activity]:[]);
    const choosing=state.phase==='choosing',paired=candidates.length===2;
    const other=candidates.find(a=>a.id!==state.requestedId);
    this.get('#title').textContent=(choosing?other?.title:state.activity?.title)??'讲座预约';
    this.get('#pair-question').hidden=!choosing;
    this.get('#single').hidden=!choosing;
    this.get('#join').hidden=!choosing;
    this.get('#candidates').hidden=choosing||candidates.length===0;
    this.get('#candidates').dataset.paired=String(paired);
    this.get('.priority').hidden=!paired;
    for(const [id,value] of [['online-first','online'],['offline-first','offline']] as const){
      const button=this.get<HTMLButtonElement>('#'+id);
      button.disabled=state.phase!=='ready';button.setAttribute('aria-pressed',String((state.preferred??'online')===value));
    }
    const signature=JSON.stringify([candidates,state.candidateIndex,state.phase,state.message,state.ocrStatus,state.fullIds]);
    if(signature!==this.candidateSignature){
      this.candidateSignature=signature;
      this.get('ol').replaceChildren(...candidates.map((item,i)=>{
        const row=document.createElement('li'),current=i===(state.candidateIndex??0);
        const full=Boolean(state.fullIds?.includes(item.id)||current&&state.phase==='failed'&&state.message.includes('人数已满'));
        const success=current&&state.phase==='success';
        row.dataset.current=String(current);
        row.classList.toggle('full',full);row.classList.toggle('success',success);
        row.classList.toggle('failed',current&&state.phase==='failed'&&!full);
        row.classList.toggle('active',current&&!full&&!['success','failed'].includes(state.phase));
        const name=document.createElement('span'),status=document.createElement('span'),m=mode(item);
        name.className='candidate-name';status.className='candidate-status';
        name.textContent=`${paired?`${i+1}. `:''}${m==='online'?'线上 · ':m==='offline'?'线下 · ':''}${item.place||item.title}`;
        status.textContent=full?(current&&state.phase==='failed'?'已满，预约失败':'已满'):current?progress(state):'未尝试';
        row.append(name,status);return row;
      }));
    }
    // Only metadata-free loading/recovery needs a standalone status line.
    const standalone=!choosing&&candidates.length===0;
    this.get('#status').hidden=!standalone||!progress(state);
    this.get('#status').textContent=standalone?progress(state):'';
    this.get('.overview').hidden=!['ready','waiting','captcha-loading','recognizing','prepared'].includes(state.phase);
    this.get('.clock').textContent=duration(state.remaining??Math.max(0,(state.activity?.startsAt??Date.now())-Date.now()-(state.offset??0)));
    this.get('#export').hidden=choosing;
    this.get<HTMLButtonElement>('#export').disabled=this.exporting||['submitting','verifying'].includes(state.phase);
    this.host.dataset.ocr=state.ocrStatus;this.host.dataset.phase=state.phase;
    this.get('#start').hidden=state.phase!=='ready';
    this.get<HTMLButtonElement>('#start').disabled=!allowed.start;
    this.get('#start').textContent=(state.activity?.startsAt??0)>Date.now()+(state.offset??0)?'开始等待':'立即预约';
    this.get('#login').hidden=state.phase!=='login-required';this.get('#resume').hidden=state.phase!=='login-required';
    this.get('#verify').hidden=state.phase!=='unknown';this.get('#reload').hidden=state.phase!=='success';
    this.get('#hide').hidden=!state.armed||['submitting','verifying'].includes(state.phase);
    this.get('#close').hidden=choosing;this.get<HTMLButtonElement>('#close').disabled=!allowed.close;
    if(['success','failed','unknown','login-required'].includes(state.phase))this.show();
  }
}
