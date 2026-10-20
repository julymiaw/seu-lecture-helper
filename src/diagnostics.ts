import {version} from '../package.json';
import {ApiError} from './api';
import {logStore} from './log-store';
export const VERSION = version;
type Fields = Record<string, string | number | boolean | undefined>;
type Level = 'log' | 'warn' | 'error';
let sequence = 0;
export function failureLevel(error: unknown): 'warn' | 'error' {
  return error instanceof ApiError && error.kind !== 'format' ? 'warn' : 'error';
}
// Only explicitly selected primitive fields enter the console; never pass requests or errors.
export function errorInfo(error: unknown): Fields {
  if (error instanceof ApiError) return {
    serverMessage: error.feedback?.msg, responseCode: error.feedback?.code, responseData: error.feedback?.datas === null ? 'null' : error.feedback?.datas,
    kind: error.kind, httpStatus: error.httpStatus,
    reason: error.kind === 'business' ? businessReason(error.message) : error.kind === 'network' && error.message.includes('超时') ? 'timeout' : error.kind,
  };
  return {kind: 'unexpected'};
}
export function businessReason(text: string) {
  if (text.includes('频繁') || text.includes('限流')) return 'rate';
  if (text.includes('登录') || text.includes('权限')) return 'session-or-permission';
  if (text.includes('已预约') || text.includes('重复预约')) return 'already-booked';
  if (text.includes('尚未开放预约')) return 'not-open';
  if (text.includes('验证码')) return 'captcha-rejected';
  if (text.includes('人数已满')) return 'full';
  if (text.includes('结束')) return 'ended';
  if (text.includes('取消')) return 'cancelled';
  return 'other';
}
export class Diagnostics {
  private readonly id = `${Date.now().toString(36)}-${++sequence}-${crypto.randomUUID()}`;
  readonly run:string;
  private seq=0;
  constructor(run?:string){this.run=run??this.id;}
  record(level: Level, event: string, fields: Fields = {}) {
    const row={...fields,version:VERSION,run:this.run,task:this.id,seq:++this.seq,at:new Date().toISOString(),level,event};
    try{logStore.append(row);}catch{/* Optional diagnostics must never interrupt booking. */}
    try{console[level]('[SEU预约助手]',row);}catch{/* Console may be unavailable. */}
    if(event==='状态变化' && ['success','failed','unknown','login-required','closed'].includes(String(fields.phase)))void logStore.flush();
  }

  async measure<T>(stage: string, operation: () => Promise<T>, fields: Fields = {}, stale = () => false): Promise<T> {
    if(stage==='预约提交')this.record('log', stage + '开始', fields);
    const started = performance.now();
    try {
      const result = await operation();
      this.record('log', stage + '完成', {...fields, durationMs: Math.round(performance.now() - started), ...(stale()?{stale:true}:{})});
      return result;
    } catch (error) {
      this.record(failureLevel(error), stage + '失败', {...fields, durationMs: Math.round(performance.now() - started), ...(stale()?{stale:true}:{}), ...errorInfo(error)});
      throw error;
    }
  }
}
