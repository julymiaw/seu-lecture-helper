import {controls, type State} from './reservation';
export interface Actions {submit(code:string):void; edit(code:string):void; refresh():void; verify():void; close():void; start():void; configure(seconds:number):void; hide():void; reload():void}
export function duration(ms:number){const seconds=Math.max(0,Math.ceil(ms/1000));return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(x=>String(x).padStart(2,'0')).join(':');}
export class Dialog {
  readonly host=document.createElement('div');
  readonly root=this.host.attachShadow({mode:'open'});
  private panel:HTMLDialogElement;
  private lastImage?:string;
  constructor(actions:Actions){
    this.host.id='seu-lecture-helper-dialog';
    this.root.innerHTML=`<style>
:host{all:initial;font-family:system-ui,"Microsoft YaHei",sans-serif;color:#18251e}
*{box-sizing:border-box}dialog{width:min(620px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;border:1px solid #dfe8e2;border-radius:18px;padding:24px;background:white;color:inherit;box-shadow:0 24px 80px #10251c30}dialog::backdrop{background:#10251c80}
h2{font-size:18px;line-height:1.5;margin:0 0 18px;overflow-wrap:anywhere}.overview{display:flex;justify-content:space-between;align-items:center;gap:16px;background:#f0f7f2;border-radius:12px;padding:14px 16px}.clock{font-size:32px;font-weight:650;color:#287547;font-variant-numeric:tabular-nums}.settings{font-size:13px;color:#64776a}select{font:inherit;color:#24663b;border:1px solid #ccd8cf;background:white;border-radius:7px;padding:6px}
.challenge{display:grid;grid-template-columns:1fr 1fr;align-items:center;gap:18px;margin-top:18px;padding:14px;background:#f7f9f7;border-radius:12px}img{width:160px;max-width:100%;height:64px;object-fit:contain;justify-self:center}input{width:100%;font:28px system-ui;letter-spacing:6px;border:1px solid #b2c2b7;border-radius:8px;padding:8px;color:#18251e;background:white}input:focus{outline:2px solid #287547;outline-offset:2px}
p{margin:10px 0 0;font-size:13px;line-height:1.5}#preparation{color:#9c5530}.actions{display:flex;gap:8px;align-items:center;margin-top:18px;flex-wrap:wrap}#hide{margin-left:auto}button{font:14px system-ui;min-height:38px;padding:7px 13px;border:1px solid #ccd8cf;border-radius:8px;background:white;color:#203e2d;cursor:pointer}button.primary{background:#287547;border-color:#287547;color:white}button:disabled{opacity:.5;cursor:default}[hidden]{display:none!important}@media(max-width:420px){dialog{padding:18px}.clock{font-size:25px}.overview{gap:8px;padding:12px}.challenge{gap:12px;padding:10px}input{font-size:24px;letter-spacing:4px}}
</style><dialog aria-labelledby="title"><h2 id="title">讲座预约</h2><div class="overview"><span class="clock" aria-label="距离预约开放">--:--:--</span><label class="settings">提前 <select id="lead" aria-label="提前取图时间"><option value="10">10 秒</option><option value="20">20 秒</option><option value="30" selected>30 秒</option><option value="60">60 秒</option></select> 取图</label></div><form><div class="challenge" hidden><img alt="预约验证码"><input aria-label="验证码" placeholder="验证码" maxlength="4" inputmode="numeric" autocomplete="off" spellcheck="false"></div><p id="status" role="status" aria-live="polite"></p><p id="preparation" hidden></p><div class="actions"><button type="button" id="start" class="primary">开始等待</button><button type="submit" class="primary" hidden>提交预约</button><button type="button" id="refresh" hidden>换一张</button><button type="button" id="verify" hidden>重新核验</button><button type="button" id="reload" hidden>刷新学校页面</button><button type="button" id="hide">收起</button><button type="button" id="close">关闭</button></div></form></dialog>`;
    this.panel=this.get('dialog');
    this.get<HTMLFormElement>('form').addEventListener('submit',e=>{e.preventDefault();actions.submit(this.get<HTMLInputElement>('input').value);});
    this.get<HTMLInputElement>('input').addEventListener('input',()=>actions.edit(this.get<HTMLInputElement>('input').value));
    this.get<HTMLSelectElement>('#lead').addEventListener('change',()=>actions.configure(Number(this.get<HTMLSelectElement>('#lead').value)));
    for(const id of ['start','refresh','verify','reload','hide','close'] as const)this.get('#'+id).addEventListener('click',()=>actions[id]());
    this.panel.addEventListener('cancel',e=>{e.preventDefault();actions.close();});
    document.body.append(this.host);this.show();
  }
  private get<T extends HTMLElement>(selector:string){return this.root.querySelector<T>(selector)!;}
  show(){if(!this.panel.open)this.panel.showModal();}
  hide(){this.panel.close();}
  destroy(){this.panel.close();this.host.remove();}
  render(state:State){
    const allowed=controls(state);
    this.get('#title').textContent=state.activity?.title??'讲座预约';
    this.get('#status').textContent=state.message;this.get('#status').hidden=!state.message;
    this.get('.overview').hidden=!['ready','waiting','captcha-loading','recognizing','input'].includes(state.phase);
    this.get('.clock').textContent=duration(state.remaining??Math.max(0,(state.activity?.startsAt??Date.now())-Date.now()-(state.offset??0)));
    const lead=this.get<HTMLSelectElement>('#lead');lead.value=String(state.leadSeconds??30);lead.disabled=state.phase!=='ready';
    this.get('.challenge').hidden=!state.image || ['success','failed','unknown'].includes(state.phase);
    const image=this.get<HTMLImageElement>('img'),input=this.get<HTMLInputElement>('input');
    const changed=state.image!==this.lastImage;
    if(state.image!==this.lastImage){this.lastImage=state.image;if(state.image){image.src=state.image;this.show();}else image.removeAttribute('src');}
    if(input.value!==(state.code??''))input.value=state.code??'';
    input.disabled=!allowed.edit;if(changed && state.image && allowed.edit)input.focus();
    this.host.dataset.ocr=state.ocrStatus;
    this.get('#start').hidden=state.phase!=='ready';this.get<HTMLButtonElement>('#start').disabled=!allowed.start;
    this.get('#start').textContent=(state.activity?.startsAt??0)>Date.now()+(state.offset??0)?'开始等待':'立即预约';
    this.get('[type=submit]').hidden=!state.image || (state.remaining??0)>0;
    this.get<HTMLButtonElement>('[type=submit]').disabled=!allowed.submit;
    this.get('#refresh').hidden=!state.image;this.get<HTMLButtonElement>('#refresh').disabled=!allowed.refresh;
    this.get('#verify').hidden=state.phase!=='unknown';this.get('#reload').hidden=state.phase!=='success';
    this.get('#hide').hidden=!state.armed || ['submitting','verifying'].includes(state.phase);
    this.get<HTMLButtonElement>('#close').disabled=!allowed.close;
    this.get('#preparation').hidden=state.ocrStatus!=='failed';this.get('#preparation').textContent=state.ocrMessage??'';
    if(['success','failed','unknown'].includes(state.phase))this.show();
  }
}
