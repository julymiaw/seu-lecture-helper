export const BASE = '/gsapp/sys/yddjzxxtjappseu/modules/hdyy/';
export type Row = Record<string, unknown>;
export interface Activity {
  id: string; title: string; place: string;
  startsAt: number; endsAt: number; eventStart: string; eventEnd: string;
  reserved: boolean; cancelled: boolean; capacity: number; count: number; countKnown: boolean;
}
export class ApiError extends Error {
  feedback?: {code: number | string; datas: number | boolean | null; msg: string};
  constructor(message: string, public kind: 'business' | 'network' | 'session' | 'format' | 'rate', public httpStatus?: number) { super(message); }
}
export function schoolTime(value: unknown): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(value));
  if (!match) throw new ApiError('预约时间格式不正确', 'format');
  const [y, m, d, h, min, s] = match.slice(1).map(Number);
  const wall = Date.UTC(y, m - 1, d, h, min, s);
  const date = new Date(wall);
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || h > 23 || min > 59 || s > 59)
    throw new ApiError('预约时间无效', 'format');
  return wall - 8 * 3600_000;
}
export function activity(row: Row): Activity {
  if (!row.WID || !row.JZMC) throw new ApiError('活动信息缺少 ID 或标题', 'format');
  return {id: String(row.WID), title: String(row.JZMC), place: String(row.JZDD ?? ''),
    startsAt: schoolTime(row.YYKSSJ), endsAt: schoolTime(row.YYJSSJ), eventStart: String(row.JZSJ ?? ''), eventEnd: String(row.HDJSSJ ?? ''),
    reserved: Boolean(row.YY_WID), cancelled: String(row.FBZT) === '-1', capacity: Number(row.HDZRS ?? 0), count: Number(row.YYRS ?? 0),
    countKnown: row.YYRS !== undefined && row.YYRS !== null && String(row.YYRS).trim() !== '' && Number.isInteger(Number(row.YYRS)) && Number(row.YYRS) >= 0};
}
function rows(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new ApiError('活动响应格式已变化', 'format');
  return value;
}
export interface ReservationApi {
  list(): Promise<{activities: Activity[]; offset: number}>;
  detail(id: string): Promise<{activity: Activity; offset: number}>;
  captcha(): Promise<string>;
  submit(id: string, code: string): Promise<void>;
  booked(id: string): Promise<boolean>;
}
export class Api implements ReservationApi {
  constructor(private transport: typeof fetch = (input, init) => fetch(input, init), private now = Date.now, private timeout = 15000) {}
  private async request(name: string, data?: Record<string, string>): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    let httpStatus: number | undefined;
    try {
      const response = await this.transport(BASE + name, {
        method: data ? 'POST' : 'GET', credentials: 'same-origin', signal: controller.signal,
        headers: {'X-Requested-With': 'XMLHttpRequest', ...(data ? {'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'} : {})},
        ...(data ? {body: new URLSearchParams(data).toString()} : {}),
      });
      httpStatus = response.status;
      if (response.status === 401 || response.status === 403 || response.redirected) throw new ApiError('登录状态或访问权限异常，请在学校页面检查登录', 'session');
      if (response.status === 429) throw new ApiError('请求受到限流，请稍后再试', 'rate');
      if (!response.ok) throw new ApiError(`服务器响应异常（HTTP ${response.status}）`, 'network');
      let body: {code?: unknown; datas?: unknown; msg?: unknown};
      const text = await response.text();
      try { body = JSON.parse(text); } catch { throw new ApiError('响应不是有效 JSON，请检查登录或稍后重试', 'format'); }
      if (!body || body.code === undefined) throw new ApiError('接口响应格式已变化', 'format');
      if (String(body.code) !== '0') {
        const error = new ApiError(String(body.msg || '预约操作未成功'), 'business', httpStatus);
        // Retain only the business envelope; omit arbitrary response data and debugException.
        const msg = String(body.msg || '').replace(/data:image\/[^\s]+/gi, '[image]').replace(/(?:cookie|authorization|token|password)\s*[:=]\s*[^\s,;]+/gi, '[credential]').replace(/\b\d{4}\b/g, '[digits]').slice(0, 500);
        error.feedback = {code: typeof body.code === 'number' ? body.code : String(body.code).slice(0, 32), datas: body.datas === null || typeof body.datas === 'number' || typeof body.datas === 'boolean' ? body.datas : null, msg};
        throw error;
      }
      return body.datas;
    } catch (error) {
      if (error instanceof ApiError) {error.httpStatus ??= httpStatus; throw error;}
      throw new ApiError(controller.signal.aborted ? '网络请求超时' : '网络连接失败', 'network', httpStatus);
    } finally { clearTimeout(timer); }
  }
  async list() {
    const before = this.now();
    const data = await this.request('queryActivityList.do', {}) as Row;
    const offset = schoolTime(data.xtdqsj) - (before + this.now()) / 2;
    const counts = new Map(rows(data.hdrsList ?? []).map(x => [String(x.HD_WID), x.YYRS]));
    const bookings = new Map(rows(data.xsxxList ?? []).map(x => [String(x.WID), x]));
    const unique = new Map(rows(data.hdlbList).map(row => [String(row.WID), row]));
    return {offset, activities: [...unique.values()].map(row => activity({...row, ...bookings.get(String(row.WID)), YYRS: counts.get(String(row.WID))}))};
  }
  async detail(id: string) {
    const before = this.now();
    const data = await this.request('getActivityDetail.do', {wid: id}) as Row;
    if (!data?.hdxq) throw new ApiError('未找到活动详情', 'format');
    const item = activity(data.hdxq as Row);
    if (item.id !== id) throw new ApiError('活动详情 ID 不匹配', 'format');
    return {activity: item, offset: schoolTime(data.xtdqsj) - (before + this.now()) / 2};
  }
  async captcha() {
    const image = await this.request('vcode.do?_=' + this.now());
    if (typeof image !== 'string' || !/^data:image\/(jpeg|png|gif|webp);base64,[A-Za-z0-9+/=\s]+$/.test(image)) throw new ApiError('验证码图片格式无效', 'format');
    return image;
  }
  async submit(id: string, code: string) {
    const result = await this.request('addReservation.do', {wid: id, vcode: code});
    if (String(result) !== '1') throw new ApiError('提交结果无法确认', 'format');
  }
  async booked(id: string) {
    const data = await this.request('queryMyActivityList.do', {param: JSON.stringify({FBZT: '1'})}) as Row;
    return rows(data?.wdhdList).some(row => String(row.HD_WID) === id && Boolean(row.YY_WID) && String(row.FBZT) !== '-1');
  }
}
