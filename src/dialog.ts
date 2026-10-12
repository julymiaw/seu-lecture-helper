import {controls, knownCount, type State, type TaskMode} from './reservation';
import type {InputMode} from './ocr';
export interface Actions {submit(code: string): void; refresh(): void; verify(): void; close(): void; mode?(mode: InputMode): void; reload?(): void;
  start?(): void; pause?(): void; checkNow?(): void; configure?(options: {taskMode?: TaskMode; interval?: number; followUp?: boolean}): void; hide?(): void}
export function duration(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(x => String(x).padStart(2, '0')).join(':');
}
export class Dialog {
  readonly host = document.createElement('div');
  readonly root = this.host.attachShadow({mode: 'open'});
  private panel: HTMLDialogElement;
  private title: HTMLElement;
  private info: HTMLElement;
  private status: HTMLElement;
  private clock: HTMLElement;
  private image: HTMLImageElement;
  private input: HTMLInputElement;
  private submit: HTMLButtonElement;
  private refresh: HTMLButtonElement;
  private verify: HTMLButtonElement;
  private reload: HTMLButtonElement;
  private close: HTMLButtonElement;
  private modes: HTMLInputElement[];
  private preparation: HTMLElement;
  private modeHint: HTMLElement;
  private capacity: HTMLElement;
  private checked: HTMLElement;
  private taskModes: HTMLInputElement[];
  private interval: HTMLSelectElement;
  private followUp: HTMLInputElement;
  private start: HTMLButtonElement;
  private pause: HTMLButtonElement;
  private shrink: HTMLButtonElement;
  private checkNow: HTMLButtonElement;
  private lastPhase?: State['phase'];
  private lastImage?: string;
  constructor(actions: Actions) {
    this.host.id = 'seu-lecture-helper-dialog';
    this.root.innerHTML = `<style>
:host{all:initial;font-family:system-ui,"Microsoft YaHei",sans-serif;color:#18251e}
dialog{box-sizing:border-box;width:min(680px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow-y:auto;border:1px solid #e4ebe6;border-radius:18px;padding:24px;box-shadow:0 24px 80px #10251c30;color:inherit;background:#fff}
dialog::backdrop{background:#10251c80}
h2{font-size:18px;line-height:1.45;margin:0 0 8px;overflow-wrap:anywhere}
p{font-size:14px;line-height:1.5;margin:0;overflow-wrap:anywhere}
#info{display:none}.controls{margin-top:16px}
.controls{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:14px}
fieldset{min-width:0;border:0;padding:0;margin:0}
.sr-only,legend,#clock-label,#mode-hint,#checked,#monitor-options>label{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip-path:inset(50%)!important;white-space:nowrap!important;border:0!important}
.segments{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;border-radius:11px;background:#f0f3f1}
.segments label{position:relative;cursor:pointer}
.segments input{position:absolute;opacity:0;width:1px;height:1px}
.segments span{display:flex;align-items:center;justify-content:center;gap:6px;min-height:36px;border-radius:8px;font-size:14px;color:#6a786f;transition:background .15s,color .15s,box-shadow .15s}
.segments input:checked+span{background:#fff;color:#24663b;box-shadow:0 1px 5px #1c3e2a16;font-weight:600}
.segments input:focus-visible+span{outline:2px solid #287547;outline-offset:2px}
.segments input:disabled+span{opacity:.6;cursor:default}
.segments svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.overview{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:14px 16px;border-radius:12px;background:#f0f7f2}
.summary{min-width:0}#capacity{font-size:14px;color:#287547}#checked{font-size:12px;color:#68776e;margin-top:4px}
.clock{font-size:32px;line-height:1.2;font-variant-numeric:tabular-nums;font-weight:650;letter-spacing:1px;color:#287547;white-space:nowrap}
#status:not(.sr-only){margin-top:12px}
.preferences{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px 20px;margin-top:12px}
.preferences:not(:has(>:not([hidden]))){display:none}
#monitor-options{display:flex;align-items:center;gap:8px;font-size:12px;color:#68776e}
select{font:inherit;color:#24663b;background:#f5f8f6;border:1px solid #d5e0d8;border-radius:7px;padding:5px 8px}
#follow-option{display:flex;align-items:center;gap:6px;font-size:12px;color:#68776e}
#follow-option input{accent-color:#287547;width:15px;height:15px;margin:0}
#preparation{font-size:12px;display:flex;align-items:center;gap:6px;color:#287547;margin-top:10px}
#preparation[data-status=failed]{color:#9c5530}
#preparation[data-status=loading]::before{content:"";width:9px;height:9px;flex:none;border:2px solid #d4e3d8;border-top-color:#287547;border-radius:50%;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
form{margin-top:16px}
.challenge{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;align-items:center;padding:12px 16px;background:#f7f9f7;border-radius:12px}
img{width:140px;max-width:100%;height:auto;max-height:72px;object-fit:contain;justify-self:center;background:#fff;border:1px solid #e0e6e2;border-radius:5px}
.challenge label{font-size:12px;color:#68776e}
.challenge input{display:block;box-sizing:border-box;margin-top:4px;width:100%;max-width:180px;min-height:42px;border:1px solid #b2c2b7;border-radius:8px;padding:7px 9px;font:22px system-ui;letter-spacing:3px;color:#18251e;background:#fff}
.challenge input:focus{outline:2px solid #287547;outline-offset:2px}
button{font:14px system-ui;cursor:pointer;min-height:38px;padding:7px 13px;border-radius:8px;border:1px solid #ccd8cf;background:#fff;color:#203e2d}
button:disabled{opacity:.5;cursor:default}.primary{background:#287547;color:white;border-color:#287547}
.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.challenge:not([hidden])+.actions{margin-top:14px}
.task-actions{display:flex;align-items:center;gap:8px;margin-left:auto}
[hidden]{display:none!important}
@media(max-width:520px){dialog{padding:20px}.controls{grid-template-columns:1fr;gap:8px}.overview{gap:12px;padding:12px}.clock{font-size:27px}#capacity{font-size:13px}.challenge{gap:12px;padding:12px}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style><dialog aria-labelledby="title"><h2 id="title">讲座预约</h2><p id="info"></p><p id="status" role="status" aria-live="polite"></p><p class="clock" hidden></p><fieldset><legend>验证码方式</legend><div class="segments"><label><input type="radio" name="mode" value="ocr"><span><svg aria-hidden="true" viewBox="0 0 20 20"><rect x="5" y="5" width="10" height="10" rx="2"/><path d="M8 2v3m4-3v3M8 15v3m4-3v3M2 8h3m-3 4h3m10-4h3m-3 4h3"/></svg>自动识别</span></label><label><input type="radio" name="mode" value="manual"><span><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m4 13 9-9 3 3-9 9-4 1 1-4Zm7-7 3 3"/></svg>手动输入</span></label></div></fieldset><p id="mode-hint"></p><p id="preparation" aria-live="polite" hidden></p><form><div class="challenge" hidden><img alt="预约验证码"><label><span class="sr-only">验证码</span><input placeholder="验证码" aria-label="验证码" maxlength="4" autocomplete="off" spellcheck="false"></label></div><div class="actions"><button type="submit" class="primary" hidden>提交预约</button><button type="button" id="refresh" hidden>换一张</button><button type="button" id="verify" hidden>重新核验</button><button type="button" id="close">关闭</button></div></form></dialog>`;
    const get = <T extends Element>(selector: string) => this.root.querySelector<T>(selector)!;
    this.panel = get('dialog'); this.title = get('#title'); this.info = get('#info'); this.status = get('#status'); this.clock = get('.clock');
    this.image = get('img'); this.input = get('input[aria-label="验证码"]'); this.submit = get('[type=submit]'); this.refresh = get('#refresh'); this.verify = get('#verify'); this.close = get('#close');
    this.modes = [...this.root.querySelectorAll<HTMLInputElement>('[name=mode]')];
    this.preparation = get('#preparation'); this.modeHint = get('#mode-hint');
    this.capacity = document.createElement('p'); this.capacity.id = 'capacity'; this.info.after(this.capacity);
    const taskOptions = document.createElement('fieldset');
    taskOptions.innerHTML = `<legend>预约方式</legend><div class="segments"><label><input type="radio" name="task-mode" value="scheduled"><span>定时预约</span></label><label><input type="radio" name="task-mode" value="monitor"><span>余位监测</span></label></div>`;
    this.status.before(taskOptions);
    this.taskModes = [...taskOptions.querySelectorAll<HTMLInputElement>('input')];
    this.taskModes.forEach(input => input.onchange = () => {if (input.checked) actions.configure?.({taskMode: input.value as TaskMode});});
    this.checked = document.createElement('p'); this.checked.id = 'checked'; this.clock.after(this.checked);
    const clockLabel = document.createElement('p'); clockLabel.id = 'clock-label'; clockLabel.hidden = true; this.clock.before(clockLabel);
    const options = document.createElement('div'); options.id = 'monitor-options';
    options.innerHTML = `<label for="interval">检查间隔</label><select id="interval" aria-label="检查间隔"><option value="30">每 30 秒</option><option value="60">每 60 秒</option><option value="120">每 120 秒</option></select>`;
    this.checked.after(options); this.interval = get('#interval');
    this.interval.onchange = () => actions.configure?.({interval: Number(this.interval.value)});
    const follow = document.createElement('label'); follow.id = 'follow-option';
    follow.innerHTML = `<input type="checkbox" id="follow-up">未抢到时继续监测余位`;
    options.after(follow); this.followUp = get('#follow-up');
    this.followUp.onchange = () => actions.configure?.({followUp: this.followUp.checked});
    const button = (id: string, text: string, action: () => void) => {
      const b = document.createElement('button'); b.id = id; b.type = 'button'; b.textContent = text; b.hidden = true;
      b.onclick = action; this.close.before(b); return b;
    };
    this.start = button('start', '开始等待', () => actions.start?.()); this.start.className = 'primary';
    this.pause = button('pause', '暂停监测', () => actions.pause?.());
    this.shrink = button('shrink', '收起', () => actions.hide?.());
    this.reload = document.createElement('button');
    this.reload.type = 'button'; this.reload.id = 'reload'; this.reload.textContent = '刷新学校页面'; this.reload.hidden = true;
    const controls = document.createElement('div'); controls.className = 'controls';
    controls.append(taskOptions, this.modes[0].closest('fieldset')!);
    const overview = document.createElement('div'); overview.className = 'overview';
    const summary = document.createElement('div'); summary.className = 'summary'; summary.append(this.capacity, this.checked);
    const countdown = document.createElement('div'); countdown.append(clockLabel, this.clock);
    overview.append(summary, countdown);
    const preferences = document.createElement('div'); preferences.className = 'preferences'; preferences.append(follow, options);
    this.info.after(controls, overview, this.status, preferences, this.modeHint, this.preparation);
    this.reload.title = '重新加载学校页面，使原预约按钮与服务器状态同步';
    this.close.before(this.reload); this.reload.onclick = () => actions.reload?.();
    this.checkNow = button('check-now', '立即检查', () => actions.checkNow?.());
    const taskActions = document.createElement('div'); taskActions.className = 'task-actions';
    this.close.before(taskActions); taskActions.append(this.checkNow, this.close);
    this.modes.forEach(input => input.onchange = () => {if (input.checked) actions.mode?.(input.value as InputMode);});
    get('form').addEventListener('submit', event => {event.preventDefault(); if (!this.submit.disabled && !this.submit.hidden) actions.submit(this.input.value);});
    this.input.addEventListener('keydown', event => {if (event.key === 'Enter' && event.isComposing) event.preventDefault();});
    this.refresh.onclick = () => actions.refresh(); this.verify.onclick = () => actions.verify(); this.close.onclick = () => actions.close();
    this.panel.addEventListener('cancel', event => {event.preventDefault(); actions.close();});
    document.body.append(this.host); this.panel.showModal();
  }
  render(state: State) {
    const {activity, phase} = state;
    const allowed = controls(state);
    if (!this.panel.open && !['waiting', 'monitoring', 'paused', 'ready', 'closed'].includes(phase)) this.show();
    this.title.textContent = activity?.title ?? '讲座预约';
    this.info.textContent = activity ? `${activity.category} · ${activity.place}\n开放时间：${new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false}).format(activity.startsAt)}` : '';
    this.info.style.whiteSpace = 'pre-line';
    this.status.textContent = state.message;
    const routine = ['ready', 'waiting', 'recognizing', 'captcha-loading'].includes(phase) || phase === 'input' && state.message.startsWith('输入验证码') || phase === 'paused' && state.message === '监测已暂停' || phase === 'monitoring' &&
      (state.checking || state.message === '正在等待空余名额' || state.message.startsWith('等待预约开放') || state.message.startsWith('名额已满'));
    this.status.className = routine && !state.error ? 'sr-only' : '';
    const monitor = state.taskMode === 'monitor';
    this.capacity.hidden = !activity;
    this.capacity.textContent = activity ? knownCount(activity) ? `${activity.count} / ${activity.capacity}` : '— / —' : '';
    this.taskModes.forEach(input => {input.checked = input.value === (state.taskMode ?? 'scheduled'); input.disabled = !allowed[input.value as TaskMode];});
    this.interval.value = String(state.interval ?? 60);
    this.interval.disabled = !allowed.interval;
    this.root.querySelector<HTMLElement>('#monitor-options')!.hidden = !monitor && !state.followUp;
    this.followUp.checked = Boolean(state.followUp); this.followUp.disabled = !allowed.followUp;
    this.root.querySelector<HTMLElement>('#follow-option')!.hidden = monitor || !['ready', 'waiting'].includes(phase);
    this.clock.hidden = phase !== 'waiting' && !(phase === 'monitoring' && state.nextCheck);
    this.clock.textContent = duration(state.remaining ?? 0);
    this.clock.setAttribute('aria-label', monitor ? '距离下次检查' : '距离预约开放');
    const clockLabel = this.root.querySelector<HTMLElement>('#clock-label')!; clockLabel.hidden = this.clock.hidden; clockLabel.textContent = monitor ? '下次检查倒计时' : '距离预约开放';
    this.checked.hidden = !monitor;
    this.checked.textContent = state.lastChecked ? `上次检查 ${new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false}).format(state.lastChecked)}` : '尚未检查';
    this.start.hidden = !['ready', 'paused'].includes(phase);
    this.start.disabled = !allowed.start;
    this.start.textContent = phase === 'paused' ? '继续监测' : monitor ? '开始监测' : activity && activity.startsAt <= Date.now() + (state.offset ?? 0) ? '立即预约' : '开始等待';
    this.pause.hidden = phase !== 'monitoring'; this.shrink.hidden = !['waiting', 'monitoring'].includes(phase);
    this.checkNow.hidden = !monitor || phase !== 'monitoring'; this.checkNow.disabled = !allowed.checkNow;
    this.checkNow.setAttribute('aria-busy', String(Boolean(state.checking)));
    this.close.textContent = monitor && ['monitoring', 'paused'].includes(phase) ? '停止监测' : '关闭';
    const mode = state.mode ?? 'manual';
    this.modes.forEach(input => {input.checked = input.value === mode; input.disabled = input.value === 'manual' ? !allowed.manual : !allowed.mode;});
    this.modeHint.textContent = mode === 'ocr' ? '本地识别后自动提交；异常时转为手动输入。' : '自行输入验证码，按回车或点击按钮提交。';
    this.preparation.hidden = state.ocrStatus !== 'failed';
    this.preparation.dataset.status = state.ocrStatus ?? '';
    this.preparation.textContent = state.ocrStatus === 'ready' ? 'OCR 已就绪' : state.ocrMessage ?? '';
    const editable = allowed.submit;
    this.root.querySelector<HTMLElement>('.challenge')!.hidden = !state.image || !['input', 'recognizing'].includes(phase);
    this.submit.hidden = !editable; this.submit.disabled = !editable;
    this.input.disabled = !editable;
    this.refresh.hidden = !editable;
    this.refresh.textContent = phase === 'failed' ? '重新获取验证码' : '换一张';
    this.verify.hidden = phase !== 'unknown';
    this.reload.hidden = phase !== 'success';
    this.close.disabled = phase === 'submitting' || phase === 'verifying';
    this.close.title = this.close.disabled ? '提交和核验完成后可关闭；关闭不能撤销预约' : '';
    const changedImage = state.image !== this.lastImage;
    if (changedImage) {
      this.lastImage = state.image; this.input.value = '';
      if (state.image) this.image.src = state.image; else this.image.removeAttribute('src');
    }
    if (editable && (changedImage || this.lastPhase !== 'input')) this.input.focus();
    this.lastPhase = phase;
  }
  hide() {this.panel.close();}
  show() {if (!this.panel.open) this.panel.showModal();}
  destroy() {this.panel.close(); this.host.remove();}
}
