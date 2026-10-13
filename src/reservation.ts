import {ApiError, type Activity, type ReservationApi} from './api';
import type {InputMode, OcrEngine} from './ocr';
export type TaskMode = 'scheduled' | 'monitor';
export type Phase = 'loading' | 'ready' | 'waiting' | 'monitoring' | 'paused' | 'captcha-loading' | 'recognizing' | 'input' | 'submitting' | 'verifying' | 'success' | 'failed' | 'unknown' | 'closed';
export interface State {phase: Phase; activity?: Activity; message: string; remaining?: number; image?: string; mode?: InputMode; ocrStatus?: 'loading' | 'ready' | 'failed'; ocrMessage?: string;
  taskMode?: TaskMode; interval?: number; followUp?: boolean; lastChecked?: number; nextCheck?: number; checking?: boolean; offset?: number; full?: boolean; error?: boolean; manualFallback?: boolean; retryAt?: number}
export function knownCount(item: Activity) {
  return item.countKnown && Number.isInteger(item.count) && item.count >= 0 && Number.isInteger(item.capacity) && item.capacity > 0 && item.count <= item.capacity;
}
export function fullCapacity(state: State) {
  const item = state.activity;
  return Boolean(state.full || item?.countKnown && Number.isInteger(item.capacity) && item.capacity > 0 && Number.isInteger(item.count) && item.count >= item.capacity);
}
// UI and request entry points share the same permissions. Phase alone is insufficient.
export function controls(state: State, now = Date.now()) {
  const item = state.activity, serverNow = now + (state.offset ?? 0);
  const active = Boolean(item && !item.reserved && !item.cancelled && serverNow < item.endsAt);
  const adjustable = active && ['ready', 'waiting', 'monitoring', 'paused', 'captcha-loading', 'recognizing', 'input'].includes(state.phase);
  const free = !fullCapacity(state);
  return {
    scheduled: adjustable && free, monitor: adjustable, mode: adjustable,
    manual: adjustable && (state.taskMode !== 'monitor' || Boolean(state.manualFallback)),
    checkNow: active && state.phase === 'monitoring' && !state.checking && !(state.retryAt && state.retryAt > now) && serverNow >= item!.startsAt,
    start: active && ['ready', 'paused'].includes(state.phase) && (state.taskMode === 'monitor' || free),
    submit: active && free && state.phase === 'input' && Boolean(state.image) && serverNow >= item!.startsAt,
    interval: active && ['ready', 'waiting', 'monitoring', 'paused'].includes(state.phase),
    followUp: active && ['ready', 'waiting'].includes(state.phase),
  };
}
export class Reservation {
  state: State = {phase: 'closed', message: ''};
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private wake?: () => void;
  private offset = 0;
  private ocrEpoch = 0;
  private autoSubmitted = false;
  private ocrAttempts = 0;
  private mode: InputMode;
  private scheduledMode: InputMode;
  private checking = false;
  private failures = 0;
  constructor(private api: ReservationApi, private publish: (state: State) => void, private now = Date.now, private owns = () => true, private ocr?: OcrEngine, mode: InputMode = 'manual', private random = Math.random) {this.mode = mode; this.scheduledMode = mode;}
  private set(phase: Phase, message: string, extras: Partial<State> = {}) {
    this.state = {...this.state, phase, message, ...extras}; this.publish(this.state);
  }
  private valid(g: number) { return g === this.generation && this.state.phase !== 'closed'; }
  setMode(mode: InputMode) {
    const allowed = controls(this.state, this.now());
    if (!allowed.mode || mode === 'manual' && !allowed.manual) return;
    if (mode === 'ocr' && this.mode !== 'ocr') {this.autoSubmitted = false; this.ocrAttempts = 0;}
    this.mode = mode; ++this.ocrEpoch;
    if (this.state.taskMode !== 'monitor') this.scheduledMode = mode;
    const phase = this.state.phase === 'recognizing' ? 'input' : this.state.phase;
    this.set(phase, phase === 'input' ? '输入验证码后按回车或点击提交' : this.state.message, {mode});
    if (mode === 'ocr') {
      void this.prepareOcr();
      if (phase === 'input' && this.state.image && !this.autoSubmitted && controls(this.state, this.now()).submit) void this.recognize(this.state.image);
    }
  }
  private async prepareOcr() {
    if (!this.ocr) {this.manual('本地识别不可用，请手动输入验证码'); return;}
    if (this.state.ocrStatus === 'ready') return;
    const g = this.generation;
    this.set(this.state.phase, this.state.message, {ocrStatus: 'loading', ocrMessage: '正在准备本地识别 · 首次下载约 68 MB'});
    try {
      await this.ocr.prepare();
      if (this.valid(g)) this.set(this.state.phase, this.state.message, {ocrStatus: 'ready', ocrMessage: '本地识别已就绪 · 验证码不上传'});
    } catch (error) {
      if (!this.valid(g)) return;
      this.set(this.state.phase, this.state.message, {ocrStatus: 'failed', ocrMessage: message(error)});
      if (this.mode === 'ocr') this.manual('OCR 加载失败，已切换手动输入');
    }
  }
  private manual(text: string) {
    this.mode = 'manual'; ++this.ocrEpoch;
    this.set(this.state.phase === 'recognizing' ? 'input' : this.state.phase, text, {mode: 'manual', manualFallback: this.state.taskMode === 'monitor'});
  }
  private inputForTask(taskMode: TaskMode): Partial<State> {
    this.ocrAttempts = 0;
    this.mode = taskMode === 'monitor' ? 'ocr' : this.scheduledMode; ++this.ocrEpoch;
    return {mode: this.mode, manualFallback: false};
  }
  private async recognize(image: string) {
    if (!this.ocr || this.mode !== 'ocr' || this.autoSubmitted || !controls(this.state, this.now()).submit) return;
    const g = this.generation, epoch = ++this.ocrEpoch;
    ++this.ocrAttempts;
    this.set('recognizing', '正在本地识别验证码；可切换为手动输入');
    try {
      const code = (await this.ocr.recognize(image)).trim();
      if (!this.valid(g) || epoch !== this.ocrEpoch || this.mode !== 'ocr' || this.state.image !== image || this.state.phase !== 'recognizing') return;
      if (!/^[a-z0-9]{4}$/i.test(code)) {await this.retryOcr('未识别出完整的 4 位验证码'); return;}
      this.autoSubmitted = true;
      this.set('input', '验证码识别完成，正在提交');
      await this.submit(code);
    } catch {
      if (this.valid(g) && epoch === this.ocrEpoch) await this.retryOcr('自动识别失败');
    }
  }
  private async retryOcr(reason: string, rejected = false) {
    if (this.state.ocrStatus === 'failed') {
      this.manual(`${reason}，自动尝试已停止，请手动输入`);
      if (rejected) {this.set('input', this.state.message, {image: undefined}); await this.loadCaptcha();}
      return;
    }
    const g = this.generation;
    this.autoSubmitted = false;
    this.set('captcha-loading', `${reason}，正在检查余位并换图重试（第 ${this.ocrAttempts + 1} 次）`, {image: undefined});
    try {
      const data = await this.api.list();
      if (!this.valid(g)) return;
      const item = data.activities.find(x => x.id === this.state.activity!.id);
      if (!item) throw new Error('列表中未找到该活动，已停止自动重试');
      this.offset = data.offset;
      this.state = {...this.state, activity: item, offset: this.offset, lastChecked: this.now(), full: false};
      if (!this.bookable()) return;
      if (!knownCount(item)) throw new Error('无法确认剩余人数，已停止自动重试');
      if (fullCapacity(this.state)) {
        const continueMonitoring = this.state.taskMode === 'monitor' || this.state.followUp;
        this.offerMonitor('当前活动预约人数已满，请重新选择');
        if (continueMonitoring) this.scheduleMonitor(this.jitter(), '名额已满，继续等待空余名额');
        return;
      }
      this.set('input', '正在更新验证码');
      await this.loadCaptcha();
    } catch (error) {
      if (this.valid(g)) this.set('failed', message(error));
    }
  }
  private allowed() {
    if (this.owns()) return true;
    this.set('failed', '预约任务已由其他标签页接管，请关闭后重试'); return false;
  }
  private wait(ms: number) {
    return new Promise<void>(resolve => { this.wake = resolve; this.timer = setTimeout(() => {this.wake = undefined; resolve();}, ms); });
  }
  async open(id: string, autoStart = true) {
    const g = ++this.generation;
    this.autoSubmitted = false;
    this.ocrAttempts = 0;
    this.state = {phase: 'loading', message: '正在获取活动信息', mode: this.mode, taskMode: 'scheduled', interval: 60, followUp: false}; this.publish(this.state);
    if (this.mode === 'ocr') void this.prepareOcr();
    try {
      const data = await this.api.list();
      if (!this.valid(g)) return;
      let item = data.activities.find(x => x.id === id); this.offset = data.offset;
      if (!item) { const detail = await this.api.detail(id); item = detail.activity; this.offset = detail.offset; }
      if (!this.valid(g)) return;
      this.state = {...this.state, activity: item, offset: this.offset, lastChecked: this.now()};
      if (item.reserved) { this.set('success', '该活动已有预约记录'); return; }
      if (item.cancelled) {this.set('failed', '活动已取消'); return;}
      if (this.now() + this.offset >= item.endsAt) {this.set('failed', '预约时间已结束'); return;}
      const full = fullCapacity(this.state);
      const taskMode = full ? 'monitor' : 'scheduled';
      this.set('ready', full ? '当前人数已满，可开启低频余位监测' : '选择预约方式后开始', {taskMode, ...(full ? this.inputForTask('monitor') : {mode: this.mode, manualFallback: false})});
      if (full) void this.prepareOcr();
      if (autoStart) this.start();
    } catch (error) { if (this.valid(g)) this.set('failed', message(error)); }
  }
  configure(options: {taskMode?: TaskMode; interval?: number; followUp?: boolean}) {
    const allowed = controls(this.state, this.now());
    if (options.taskMode && options.taskMode !== this.state.taskMode) {
      if (!allowed[options.taskMode]) return;
      this.cancelPending(); this.autoSubmitted = false;
      this.set('ready', '选择预约方式后开始', {taskMode: options.taskMode, ...this.inputForTask(options.taskMode), image: undefined, nextCheck: undefined, remaining: undefined, checking: false, error: false, retryAt: undefined});
      if (this.mode === 'ocr') void this.prepareOcr();
    }
    const current = controls(this.state, this.now());
    const extras: Partial<State> = {};
    if (current.interval && options.interval && [30, 60, 120].includes(options.interval)) extras.interval = options.interval;
    if (current.followUp && options.followUp !== undefined) extras.followUp = options.followUp;
    if (!Object.keys(extras).length) return;
    this.set(this.state.phase, this.state.message, extras);
    // Keep this round's deadline; the new interval is read when scheduling the next round.
  }
  start() {
    if (!['ready', 'paused'].includes(this.state.phase) || !this.state.activity || !this.allowed()) return;
    if (!this.bookable()) return;
    if (this.state.taskMode !== 'monitor' && fullCapacity(this.state)) {this.offerMonitor(); return;}
    this.failures = 0;
    this.state = {...this.state, error: false};
    if (this.mode === 'ocr' && this.state.ocrStatus !== 'ready') void this.prepareOcr();
    if (this.state.taskMode === 'monitor') {this.set('monitoring', '正在查询余位', {checking: this.checking, retryAt: undefined}); void this.checkMonitor(this.generation); return;}
    const g = this.generation;
    const tick = () => {
      if (!this.valid(g)) return;
      const remaining = this.state.activity!.startsAt - this.now() - this.offset;
      if (remaining <= 0) {void this.loadCaptcha(); return;}
      this.set('waiting', '等待预约开放；请保持本页打开', {remaining});
      this.timer = setTimeout(tick, Math.min(250, remaining));
    };
    tick();
  }
  pause(text = '监测已暂停') {
    if (this.state.phase !== 'monitoring') return;
    ++this.generation; clearTimeout(this.timer);
    this.set('paused', text, {nextCheck: undefined, remaining: undefined, checking: false});
  }
  checkNow() {
    if (this.checking || !controls(this.state, this.now()).checkNow) return;
    clearTimeout(this.timer);
    void this.checkMonitor(this.generation);
  }
  private jitter() {return (this.state.interval ?? 60) * 1000 * (0.9 + this.random() * 0.2);}
  private scheduleMonitor(delay: number, text: string, backoff = false) {
    clearTimeout(this.timer);
    const g = this.generation, nextCheck = this.now() + delay;
    const tick = () => {
      if (!this.valid(g) || this.state.phase !== 'monitoring') return;
      if (this.now() + this.offset >= this.state.activity!.endsAt) {this.set('failed', '预约时间已结束', {nextCheck: undefined, remaining: undefined}); return;}
      const remaining = nextCheck - this.now();
      if (remaining <= 0) {void this.checkMonitor(g); return;}
      this.set('monitoring', text, {nextCheck, remaining, checking: false});
      this.timer = setTimeout(tick, Math.min(1000, remaining));
    };
    this.set('monitoring', text, {image: undefined, nextCheck, checking: false, retryAt: backoff ? nextCheck : undefined}); tick();
  }
  private async checkMonitor(g: number) {
    if (this.checking || !this.valid(g) || this.state.phase !== 'monitoring' || !this.allowed()) return;
    if (this.now() + this.offset >= this.state.activity!.endsAt) {this.set('failed', '预约时间已结束'); return;}
    this.checking = true;
    this.set('monitoring', '正在查询余位', {checking: true, nextCheck: undefined, remaining: undefined, retryAt: undefined});
    try {
      const data = await this.api.list();
      if (!this.valid(g) || this.state.phase !== 'monitoring') return;
      const item = data.activities.find(x => x.id === this.state.activity!.id);
      if (!item) {this.pause('列表中未找到该活动，请在学校页面检查'); return;}
      this.offset = data.offset; this.failures = 0;
      this.state = {...this.state, activity: item, offset: this.offset, full: false, error: false, lastChecked: this.now(), checking: false};
      if (item.reserved) {this.set('success', '该活动已有预约记录'); return;}
      if (item.cancelled) {this.set('failed', '活动已取消'); return;}
      const serverNow = this.now() + this.offset;
      if (serverNow >= item.endsAt) {this.set('failed', '预约时间已结束'); return;}
      if (serverNow < item.startsAt) {this.scheduleMonitor(item.startsAt - serverNow, '等待预约开放后检查余位'); return;}
      if (!knownCount(item)) {this.scheduleMonitor(this.jitter(), '人数数据暂不完整，等待下一次检查'); return;}
      if (item.count >= item.capacity) {this.scheduleMonitor(this.jitter(), '正在等待空余名额'); return;}
      this.autoSubmitted = false;
      this.ocrAttempts = 0;
      await this.loadCaptcha();
    } catch (error) {
      if (!this.valid(g) || this.state.phase !== 'monitoring') return;
      if (!(error instanceof ApiError) || error.kind !== 'network') {this.pause(message(error)); return;}
      if (++this.failures >= 5) {this.pause('连续 5 次连接失败，监测已暂停'); return;}
      this.scheduleMonitor(Math.min(8, 2 ** this.failures) * 60_000, '连接失败，稍后重试', true);
    } finally {
      this.checking = false;
      // Resume requested during an in-flight paused query waits for that query to settle.
      if (g !== this.generation && this.state.phase === 'monitoring' && !this.state.nextCheck) void this.checkMonitor(this.generation);
    }
  }
  async loadCaptcha() {
    if (!['ready', 'waiting', 'monitoring', 'input', 'recognizing'].includes(this.state.phase)) return;
    if (!this.state.activity || !this.allowed()) return;
    if (!this.bookable()) return;
    if (fullCapacity(this.state)) {this.offerMonitor(); return;}
    if (this.now() + this.offset < this.state.activity.startsAt) return;
    if (this.state.phase === 'monitoring' && !knownCount(this.state.activity)) return;
    const g = this.generation;
    clearTimeout(this.timer); ++this.ocrEpoch;
    this.set('captcha-loading', '正在获取验证码', {image: undefined, nextCheck: undefined, remaining: undefined, checking: false});
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!this.valid(g) || !this.allowed()) return;
      try {
        const image = await this.api.captcha();
        if (this.valid(g)) {
          this.set('input', '输入验证码后按回车或点击提交', {image});
          if (this.mode === 'ocr') void this.recognize(image);
        }
        return;
      } catch (error) {
        if (!this.valid(g)) return;
        if (!(error instanceof ApiError) || error.kind !== 'network' || attempt === 2) {this.set('failed', message(error)); return;}
        this.set('captcha-loading', '取图连接失败，稍后重试');
        await this.wait((attempt + 1) * 1000);
      }
    }
  }
  async submit(code: string) {
    if (this.state.phase !== 'input' || !this.state.activity || !this.allowed()) return;
    if (!this.bookable()) return;
    if (fullCapacity(this.state)) {this.offerMonitor(); return;}
    if (!controls(this.state, this.now()).submit) return;
    code = code.trim();
    if (!code || code.length > 4) {this.set('input', '请输入 1–4 位验证码'); return;}
    if (this.now() + this.offset >= this.state.activity.endsAt) {this.set('failed', '预约时间已结束'); return;}
    const g = this.generation;
    this.set('submitting', '正在提交，请勿重复操作');
    try { await this.api.submit(this.state.activity.id, code); }
    catch (error) {
      if (!this.valid(g)) return;
      if (error instanceof ApiError && error.kind === 'business') {
        if (error.message.includes('验证码')) {
          if (this.mode === 'ocr') {await this.retryOcr(error.message, true); return;}
          this.set('input', error.message, {image: undefined});
          await this.loadCaptcha();
          if (this.state.phase === 'input') this.set('input', error.message + ' 已更新验证码');
        } else if (error.message.includes('人数已满')) {
          const continueMonitoring = this.state.taskMode === 'monitor' || this.state.followUp;
          this.offerMonitor(error.message);
          if (continueMonitoring) this.scheduleMonitor(this.jitter(), '名额已满，继续等待空余名额');
        } else this.set('failed', error.message);
        return;
      }
      // A network/format failure may follow a successful write. Never resend it.
    }
    if (this.valid(g)) await this.verify();
  }
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
        if (await this.api.booked(this.state.activity.id)) {if (this.valid(g)) this.set('success', '预约成功，已核验预约记录', {activity: {...this.state.activity, reserved: true}}); return;}
        detail = '暂未查到预约记录';
      } catch (error) {
        detail = message(error);
        if (error instanceof ApiError && ['session', 'rate'].includes(error.kind)) break;
      }
    }
    if (this.valid(g)) this.set('unknown', '结果待确认：' + detail + '。请重新核验，不要直接重复提交。');
  }
  private bookable() {
    const item = this.state.activity;
    if (!item) return false;
    if (item.reserved) {this.set('success', '该活动已有预约记录', {image: undefined}); return false;}
    if (item.cancelled || this.now() + this.offset >= item.endsAt) {
      this.set('failed', item.cancelled ? '活动已取消' : '预约时间已结束', {image: undefined}); return false;
    }
    return true;
  }
  private offerMonitor(error?: string) {
    this.cancelPending();
    this.set('ready', error ?? '选择预约方式后开始', {taskMode: 'monitor', ...this.inputForTask('monitor'), full: true, error: Boolean(error), image: undefined, nextCheck: undefined, remaining: undefined, checking: false, retryAt: undefined,
      activity: error && this.state.activity ? {...this.state.activity, countKnown: false} : this.state.activity});
    void this.prepareOcr();
  }
  private cancelPending() {
    ++this.generation; ++this.ocrEpoch; clearTimeout(this.timer); this.wake?.(); this.wake = undefined;
  }
  close(): boolean {
    if (['submitting', 'verifying'].includes(this.state.phase)) return false;
    this.cancelPending();
    this.set('closed', ''); return true;
  }
}
export function message(error: unknown) {return error instanceof Error ? error.message : '操作失败，请稍后重试';}
