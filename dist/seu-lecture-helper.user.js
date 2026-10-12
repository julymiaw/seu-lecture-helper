// ==UserScript==
// @name         SEU 研究生讲座预约助手
// @namespace    seu-lecture-helper
// @version      0.3.3
// @description  倒计时预约、低频余位监测、本地 OCR／手动验证码与结果核验
// @match        https://ehall.seu.edu.cn/gsapp/sys/yddjzxxtjappseu/*
// @noframes
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==
/*
SEU Lecture Helper third-party notices

ONNX Runtime Web 1.30.0 (bundled JavaScript and downloaded WASM)
https://github.com/microsoft/onnxruntime
Copyright (c) Microsoft Corporation

ddddocr-node 2.3.0 (downloaded common_old.onnx and character table;
its JavaScript implementation is not bundled)
https://github.com/renhaoyeh/ddddocr-node
Copyright (c) 2026 Ren-Hao Yeh
The model originates from DdddOcr: https://github.com/sml2h3/ddddocr

The components listed above are provided under the MIT License:

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
"use strict";
(() => {
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });

  // src/api.ts
  var BASE = "/gsapp/sys/yddjzxxtjappseu/modules/hdyy/";
  var ApiError = class extends Error {
    constructor(message2, kind) {
      super(message2);
      this.kind = kind;
    }
  };
  function schoolTime(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(value));
    if (!match) throw new ApiError("\u9884\u7EA6\u65F6\u95F4\u683C\u5F0F\u4E0D\u6B63\u786E", "format");
    const [y, m, d, h, min, s] = match.slice(1).map(Number);
    const wall = Date.UTC(y, m - 1, d, h, min, s);
    const date = new Date(wall);
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || h > 23 || min > 59 || s > 59)
      throw new ApiError("\u9884\u7EA6\u65F6\u95F4\u65E0\u6548", "format");
    return wall - 8 * 36e5;
  }
  function activity(row) {
    if (!row.WID || !row.JZMC) throw new ApiError("\u6D3B\u52A8\u4FE1\u606F\u7F3A\u5C11 ID \u6216\u6807\u9898", "format");
    return {
      id: String(row.WID),
      title: String(row.JZMC),
      place: String(row.JZDD ?? ""),
      category: String(row.JZXL_DISPLAY ?? ""),
      startsAt: schoolTime(row.YYKSSJ),
      endsAt: schoolTime(row.YYJSSJ),
      eventStart: String(row.JZSJ ?? ""),
      eventEnd: String(row.HDJSSJ ?? ""),
      reserved: Boolean(row.YY_WID),
      cancelled: String(row.FBZT) === "-1",
      capacity: Number(row.HDZRS ?? 0),
      count: Number(row.YYRS ?? 0),
      countKnown: row.YYRS !== void 0 && row.YYRS !== null && String(row.YYRS).trim() !== "" && Number.isInteger(Number(row.YYRS)) && Number(row.YYRS) >= 0
    };
  }
  function rows(value) {
    if (!Array.isArray(value)) throw new ApiError("\u6D3B\u52A8\u54CD\u5E94\u683C\u5F0F\u5DF2\u53D8\u5316", "format");
    return value;
  }
  var Api = class {
    constructor(transport = (input, init) => fetch(input, init), now = Date.now, timeout = 15e3) {
      this.transport = transport;
      this.now = now;
      this.timeout = timeout;
    }
    async request(name, data) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);
      try {
        const response = await this.transport(BASE + name, {
          method: data ? "POST" : "GET",
          credentials: "same-origin",
          signal: controller.signal,
          headers: { "X-Requested-With": "XMLHttpRequest", ...data ? { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" } : {} },
          ...data ? { body: new URLSearchParams(data).toString() } : {}
        });
        if (response.status === 401 || response.status === 403 || response.redirected) throw new ApiError("\u767B\u5F55\u72B6\u6001\u6216\u8BBF\u95EE\u6743\u9650\u5F02\u5E38\uFF0C\u8BF7\u5728\u5B66\u6821\u9875\u9762\u68C0\u67E5\u767B\u5F55", "session");
        if (response.status === 429) throw new ApiError("\u8BF7\u6C42\u53D7\u5230\u9650\u6D41\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5", "rate");
        if (!response.ok) throw new ApiError(`\u670D\u52A1\u5668\u54CD\u5E94\u5F02\u5E38\uFF08HTTP ${response.status}\uFF09`, "network");
        let body;
        const text = await response.text();
        try {
          body = JSON.parse(text);
        } catch {
          throw new ApiError("\u54CD\u5E94\u4E0D\u662F\u6709\u6548 JSON\uFF0C\u8BF7\u68C0\u67E5\u767B\u5F55\u6216\u7A0D\u540E\u91CD\u8BD5", "format");
        }
        if (!body || body.code === void 0) throw new ApiError("\u63A5\u53E3\u54CD\u5E94\u683C\u5F0F\u5DF2\u53D8\u5316", "format");
        if (String(body.code) !== "0") throw new ApiError(String(body.msg || "\u9884\u7EA6\u64CD\u4F5C\u672A\u6210\u529F"), "business");
        return body.datas;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(controller.signal.aborted ? "\u7F51\u7EDC\u8BF7\u6C42\u8D85\u65F6" : "\u7F51\u7EDC\u8FDE\u63A5\u5931\u8D25", "network");
      } finally {
        clearTimeout(timer);
      }
    }
    async list() {
      const before = this.now();
      const data = await this.request("queryActivityList.do", {});
      const offset = schoolTime(data.xtdqsj) - (before + this.now()) / 2;
      const counts = new Map(rows(data.hdrsList ?? []).map((x) => [String(x.HD_WID), x.YYRS]));
      const bookings = new Map(rows(data.xsxxList ?? []).map((x) => [String(x.WID), x]));
      const unique = new Map(rows(data.hdlbList).map((row) => [String(row.WID), row]));
      return { offset, activities: [...unique.values()].map((row) => activity({ ...row, ...bookings.get(String(row.WID)), YYRS: counts.get(String(row.WID)) })) };
    }
    async detail(id) {
      const before = this.now();
      const data = await this.request("getActivityDetail.do", { wid: id });
      if (!data?.hdxq) throw new ApiError("\u672A\u627E\u5230\u6D3B\u52A8\u8BE6\u60C5", "format");
      const item = activity(data.hdxq);
      if (item.id !== id) throw new ApiError("\u6D3B\u52A8\u8BE6\u60C5 ID \u4E0D\u5339\u914D", "format");
      return { activity: item, offset: schoolTime(data.xtdqsj) - (before + this.now()) / 2 };
    }
    async captcha() {
      const image = await this.request("vcode.do?_=" + this.now());
      if (typeof image !== "string" || !/^data:image\/(jpeg|png|gif|webp);base64,[A-Za-z0-9+/=\s]+$/.test(image)) throw new ApiError("\u9A8C\u8BC1\u7801\u56FE\u7247\u683C\u5F0F\u65E0\u6548", "format");
      return image;
    }
    async submit(id, code) {
      const result = await this.request("addReservation.do", { wid: id, vcode: code });
      if (String(result) !== "1") throw new ApiError("\u63D0\u4EA4\u7ED3\u679C\u65E0\u6CD5\u786E\u8BA4", "format");
    }
    async booked(id) {
      const data = await this.request("queryMyActivityList.do", { param: JSON.stringify({ FBZT: "1" }) });
      return rows(data?.wdhdList).some((row) => String(row.HD_WID) === id && Boolean(row.YY_WID) && String(row.FBZT) !== "-1");
    }
  };

  // src/reservation.ts
  function knownCount(item) {
    return item.countKnown && Number.isInteger(item.count) && item.count >= 0 && Number.isInteger(item.capacity) && item.capacity > 0 && item.count <= item.capacity;
  }
  function fullCapacity(state) {
    const item = state.activity;
    return Boolean(state.full || item?.countKnown && Number.isInteger(item.capacity) && item.capacity > 0 && Number.isInteger(item.count) && item.count >= item.capacity);
  }
  function controls(state, now = Date.now()) {
    const item = state.activity, serverNow = now + (state.offset ?? 0);
    const active = Boolean(item && !item.reserved && !item.cancelled && serverNow < item.endsAt);
    const adjustable = active && ["ready", "waiting", "monitoring", "paused", "captcha-loading", "recognizing", "input"].includes(state.phase);
    const free = !fullCapacity(state);
    return {
      scheduled: adjustable && free,
      monitor: adjustable,
      mode: adjustable,
      manual: adjustable && (state.taskMode !== "monitor" || Boolean(state.manualFallback)),
      checkNow: active && state.phase === "monitoring" && !state.checking && !(state.retryAt && state.retryAt > now) && serverNow >= item.startsAt,
      start: active && ["ready", "paused"].includes(state.phase) && (state.taskMode === "monitor" || free),
      submit: active && free && state.phase === "input" && Boolean(state.image) && serverNow >= item.startsAt,
      interval: active && ["ready", "waiting", "monitoring", "paused"].includes(state.phase),
      followUp: active && ["ready", "waiting"].includes(state.phase)
    };
  }
  var Reservation = class {
    constructor(api, publish, now = Date.now, owns = () => true, ocr, mode = "manual", random = Math.random) {
      this.api = api;
      this.publish = publish;
      this.now = now;
      this.owns = owns;
      this.ocr = ocr;
      this.random = random;
      this.mode = mode;
      this.scheduledMode = mode;
    }
    state = { phase: "closed", message: "" };
    generation = 0;
    timer;
    wake;
    offset = 0;
    ocrEpoch = 0;
    autoSubmitted = false;
    mode;
    scheduledMode;
    checking = false;
    failures = 0;
    set(phase, message2, extras = {}) {
      this.state = { ...this.state, phase, message: message2, ...extras };
      this.publish(this.state);
    }
    valid(g) {
      return g === this.generation && this.state.phase !== "closed";
    }
    setMode(mode) {
      const allowed = controls(this.state, this.now());
      if (!allowed.mode || mode === "manual" && !allowed.manual) return;
      if (mode === "ocr" && this.mode !== "ocr") this.autoSubmitted = false;
      this.mode = mode;
      ++this.ocrEpoch;
      if (this.state.taskMode !== "monitor") this.scheduledMode = mode;
      const phase = this.state.phase === "recognizing" ? "input" : this.state.phase;
      this.set(phase, phase === "input" ? "\u8F93\u5165\u9A8C\u8BC1\u7801\u540E\u6309\u56DE\u8F66\u6216\u70B9\u51FB\u63D0\u4EA4" : this.state.message, { mode });
      if (mode === "ocr") {
        void this.prepareOcr();
        if (phase === "input" && this.state.image && !this.autoSubmitted && controls(this.state, this.now()).submit) void this.recognize(this.state.image);
      }
    }
    async prepareOcr() {
      if (!this.ocr) {
        this.manual("\u672C\u5730\u8BC6\u522B\u4E0D\u53EF\u7528\uFF0C\u8BF7\u624B\u52A8\u8F93\u5165\u9A8C\u8BC1\u7801");
        return;
      }
      if (this.state.ocrStatus === "ready") return;
      const g = this.generation;
      this.set(this.state.phase, this.state.message, { ocrStatus: "loading", ocrMessage: "\u6B63\u5728\u51C6\u5907\u672C\u5730\u8BC6\u522B \xB7 \u9996\u6B21\u4E0B\u8F7D\u7EA6 27 MB" });
      try {
        await this.ocr.prepare();
        if (this.valid(g)) this.set(this.state.phase, this.state.message, { ocrStatus: "ready", ocrMessage: "\u672C\u5730\u8BC6\u522B\u5DF2\u5C31\u7EEA \xB7 \u9A8C\u8BC1\u7801\u4E0D\u4E0A\u4F20" });
      } catch (error) {
        if (!this.valid(g)) return;
        this.set(this.state.phase, this.state.message, { ocrStatus: "failed", ocrMessage: message(error) });
        if (this.mode === "ocr") this.manual("OCR \u52A0\u8F7D\u5931\u8D25\uFF0C\u5DF2\u5207\u6362\u624B\u52A8\u8F93\u5165");
      }
    }
    manual(text) {
      this.mode = "manual";
      ++this.ocrEpoch;
      this.set(this.state.phase === "recognizing" ? "input" : this.state.phase, text, { mode: "manual", manualFallback: this.state.taskMode === "monitor" });
    }
    inputForTask(taskMode) {
      this.mode = taskMode === "monitor" ? "ocr" : this.scheduledMode;
      ++this.ocrEpoch;
      return { mode: this.mode, manualFallback: false };
    }
    async recognize(image) {
      if (!this.ocr || this.mode !== "ocr" || this.autoSubmitted || !controls(this.state, this.now()).submit) return;
      const g = this.generation, epoch = ++this.ocrEpoch;
      this.set("recognizing", "\u6B63\u5728\u672C\u5730\u8BC6\u522B\u9A8C\u8BC1\u7801\uFF1B\u53EF\u5207\u6362\u4E3A\u624B\u52A8\u8F93\u5165");
      try {
        const code = (await this.ocr.recognize(image)).trim();
        if (!this.valid(g) || epoch !== this.ocrEpoch || this.mode !== "ocr" || this.state.image !== image || this.state.phase !== "recognizing") return;
        if (!/^[a-z0-9]{4}$/i.test(code)) {
          this.manual("\u672A\u8BC6\u522B\u51FA\u5B8C\u6574\u7684 4 \u4F4D\u9A8C\u8BC1\u7801\uFF0C\u8BF7\u624B\u52A8\u8F93\u5165");
          return;
        }
        this.autoSubmitted = true;
        this.set("input", "\u9A8C\u8BC1\u7801\u8BC6\u522B\u5B8C\u6210\uFF0C\u6B63\u5728\u63D0\u4EA4");
        await this.submit(code);
      } catch {
        if (this.valid(g) && epoch === this.ocrEpoch) this.manual("\u81EA\u52A8\u8BC6\u522B\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u8F93\u5165\u9A8C\u8BC1\u7801");
      }
    }
    allowed() {
      if (this.owns()) return true;
      this.set("failed", "\u9884\u7EA6\u4EFB\u52A1\u5DF2\u7531\u5176\u4ED6\u6807\u7B7E\u9875\u63A5\u7BA1\uFF0C\u8BF7\u5173\u95ED\u540E\u91CD\u8BD5");
      return false;
    }
    wait(ms2) {
      return new Promise((resolve) => {
        this.wake = resolve;
        this.timer = setTimeout(() => {
          this.wake = void 0;
          resolve();
        }, ms2);
      });
    }
    async open(id, autoStart = true) {
      const g = ++this.generation;
      this.autoSubmitted = false;
      this.state = { phase: "loading", message: "\u6B63\u5728\u83B7\u53D6\u6D3B\u52A8\u4FE1\u606F", mode: this.mode, taskMode: "scheduled", interval: 60, followUp: false };
      this.publish(this.state);
      if (this.mode === "ocr") void this.prepareOcr();
      try {
        const data = await this.api.list();
        if (!this.valid(g)) return;
        let item = data.activities.find((x) => x.id === id);
        this.offset = data.offset;
        if (!item) {
          const detail = await this.api.detail(id);
          item = detail.activity;
          this.offset = detail.offset;
        }
        if (!this.valid(g)) return;
        this.state = { ...this.state, activity: item, offset: this.offset, lastChecked: this.now() };
        if (item.reserved) {
          this.set("success", "\u8BE5\u6D3B\u52A8\u5DF2\u6709\u9884\u7EA6\u8BB0\u5F55");
          return;
        }
        if (item.cancelled) {
          this.set("failed", "\u6D3B\u52A8\u5DF2\u53D6\u6D88");
          return;
        }
        if (this.now() + this.offset >= item.endsAt) {
          this.set("failed", "\u9884\u7EA6\u65F6\u95F4\u5DF2\u7ED3\u675F");
          return;
        }
        const full = fullCapacity(this.state);
        const taskMode = full ? "monitor" : "scheduled";
        this.set("ready", full ? "\u5F53\u524D\u4EBA\u6570\u5DF2\u6EE1\uFF0C\u53EF\u5F00\u542F\u4F4E\u9891\u4F59\u4F4D\u76D1\u6D4B" : "\u9009\u62E9\u9884\u7EA6\u65B9\u5F0F\u540E\u5F00\u59CB", { taskMode, ...full ? this.inputForTask("monitor") : { mode: this.mode, manualFallback: false } });
        if (full) void this.prepareOcr();
        if (autoStart) this.start();
      } catch (error) {
        if (this.valid(g)) this.set("failed", message(error));
      }
    }
    configure(options) {
      const allowed = controls(this.state, this.now());
      if (options.taskMode && options.taskMode !== this.state.taskMode) {
        if (!allowed[options.taskMode]) return;
        this.cancelPending();
        this.autoSubmitted = false;
        this.set("ready", "\u9009\u62E9\u9884\u7EA6\u65B9\u5F0F\u540E\u5F00\u59CB", { taskMode: options.taskMode, ...this.inputForTask(options.taskMode), image: void 0, nextCheck: void 0, remaining: void 0, checking: false, error: false, retryAt: void 0 });
        if (this.mode === "ocr") void this.prepareOcr();
      }
      const current = controls(this.state, this.now());
      const extras = {};
      if (current.interval && options.interval && [30, 60, 120].includes(options.interval)) extras.interval = options.interval;
      if (current.followUp && options.followUp !== void 0) extras.followUp = options.followUp;
      if (!Object.keys(extras).length) return;
      this.set(this.state.phase, this.state.message, extras);
    }
    start() {
      if (!["ready", "paused"].includes(this.state.phase) || !this.state.activity || !this.allowed()) return;
      if (!this.bookable()) return;
      if (this.state.taskMode !== "monitor" && fullCapacity(this.state)) {
        this.offerMonitor();
        return;
      }
      this.failures = 0;
      this.state = { ...this.state, error: false };
      if (this.mode === "ocr" && this.state.ocrStatus !== "ready") void this.prepareOcr();
      if (this.state.taskMode === "monitor") {
        this.set("monitoring", "\u6B63\u5728\u67E5\u8BE2\u4F59\u4F4D", { checking: this.checking, retryAt: void 0 });
        void this.checkMonitor(this.generation);
        return;
      }
      const g = this.generation;
      const tick = () => {
        if (!this.valid(g)) return;
        const remaining = this.state.activity.startsAt - this.now() - this.offset;
        if (remaining <= 0) {
          void this.loadCaptcha();
          return;
        }
        this.set("waiting", "\u7B49\u5F85\u9884\u7EA6\u5F00\u653E\uFF1B\u8BF7\u4FDD\u6301\u672C\u9875\u6253\u5F00", { remaining });
        this.timer = setTimeout(tick, Math.min(250, remaining));
      };
      tick();
    }
    pause(text = "\u76D1\u6D4B\u5DF2\u6682\u505C") {
      if (this.state.phase !== "monitoring") return;
      ++this.generation;
      clearTimeout(this.timer);
      this.set("paused", text, { nextCheck: void 0, remaining: void 0, checking: false });
    }
    checkNow() {
      if (this.checking || !controls(this.state, this.now()).checkNow) return;
      clearTimeout(this.timer);
      void this.checkMonitor(this.generation);
    }
    jitter() {
      return (this.state.interval ?? 60) * 1e3 * (0.9 + this.random() * 0.2);
    }
    scheduleMonitor(delay, text, backoff = false) {
      clearTimeout(this.timer);
      const g = this.generation, nextCheck = this.now() + delay;
      const tick = () => {
        if (!this.valid(g) || this.state.phase !== "monitoring") return;
        if (this.now() + this.offset >= this.state.activity.endsAt) {
          this.set("failed", "\u9884\u7EA6\u65F6\u95F4\u5DF2\u7ED3\u675F", { nextCheck: void 0, remaining: void 0 });
          return;
        }
        const remaining = nextCheck - this.now();
        if (remaining <= 0) {
          void this.checkMonitor(g);
          return;
        }
        this.set("monitoring", text, { nextCheck, remaining, checking: false });
        this.timer = setTimeout(tick, Math.min(1e3, remaining));
      };
      this.set("monitoring", text, { image: void 0, nextCheck, checking: false, retryAt: backoff ? nextCheck : void 0 });
      tick();
    }
    async checkMonitor(g) {
      if (this.checking || !this.valid(g) || this.state.phase !== "monitoring" || !this.allowed()) return;
      if (this.now() + this.offset >= this.state.activity.endsAt) {
        this.set("failed", "\u9884\u7EA6\u65F6\u95F4\u5DF2\u7ED3\u675F");
        return;
      }
      this.checking = true;
      this.set("monitoring", "\u6B63\u5728\u67E5\u8BE2\u4F59\u4F4D", { checking: true, nextCheck: void 0, remaining: void 0, retryAt: void 0 });
      try {
        const data = await this.api.list();
        if (!this.valid(g) || this.state.phase !== "monitoring") return;
        const item = data.activities.find((x) => x.id === this.state.activity.id);
        if (!item) {
          this.pause("\u5217\u8868\u4E2D\u672A\u627E\u5230\u8BE5\u6D3B\u52A8\uFF0C\u8BF7\u5728\u5B66\u6821\u9875\u9762\u68C0\u67E5");
          return;
        }
        this.offset = data.offset;
        this.failures = 0;
        this.state = { ...this.state, activity: item, offset: this.offset, full: false, error: false, lastChecked: this.now(), checking: false };
        if (item.reserved) {
          this.set("success", "\u8BE5\u6D3B\u52A8\u5DF2\u6709\u9884\u7EA6\u8BB0\u5F55");
          return;
        }
        if (item.cancelled) {
          this.set("failed", "\u6D3B\u52A8\u5DF2\u53D6\u6D88");
          return;
        }
        const serverNow = this.now() + this.offset;
        if (serverNow >= item.endsAt) {
          this.set("failed", "\u9884\u7EA6\u65F6\u95F4\u5DF2\u7ED3\u675F");
          return;
        }
        if (serverNow < item.startsAt) {
          this.scheduleMonitor(item.startsAt - serverNow, "\u7B49\u5F85\u9884\u7EA6\u5F00\u653E\u540E\u68C0\u67E5\u4F59\u4F4D");
          return;
        }
        if (!knownCount(item)) {
          this.scheduleMonitor(this.jitter(), "\u4EBA\u6570\u6570\u636E\u6682\u4E0D\u5B8C\u6574\uFF0C\u7B49\u5F85\u4E0B\u4E00\u6B21\u68C0\u67E5");
          return;
        }
        if (item.count >= item.capacity) {
          this.scheduleMonitor(this.jitter(), "\u6B63\u5728\u7B49\u5F85\u7A7A\u4F59\u540D\u989D");
          return;
        }
        this.autoSubmitted = false;
        await this.loadCaptcha();
      } catch (error) {
        if (!this.valid(g) || this.state.phase !== "monitoring") return;
        if (!(error instanceof ApiError) || error.kind !== "network") {
          this.pause(message(error));
          return;
        }
        if (++this.failures >= 5) {
          this.pause("\u8FDE\u7EED 5 \u6B21\u8FDE\u63A5\u5931\u8D25\uFF0C\u76D1\u6D4B\u5DF2\u6682\u505C");
          return;
        }
        this.scheduleMonitor(Math.min(8, 2 ** this.failures) * 6e4, "\u8FDE\u63A5\u5931\u8D25\uFF0C\u7A0D\u540E\u91CD\u8BD5", true);
      } finally {
        this.checking = false;
        if (g !== this.generation && this.state.phase === "monitoring" && !this.state.nextCheck) void this.checkMonitor(this.generation);
      }
    }
    async loadCaptcha() {
      if (!["ready", "waiting", "monitoring", "input", "recognizing"].includes(this.state.phase)) return;
      if (!this.state.activity || !this.allowed()) return;
      if (!this.bookable()) return;
      if (fullCapacity(this.state)) {
        this.offerMonitor();
        return;
      }
      if (this.now() + this.offset < this.state.activity.startsAt) return;
      if (this.state.phase === "monitoring" && !knownCount(this.state.activity)) return;
      const g = this.generation;
      clearTimeout(this.timer);
      ++this.ocrEpoch;
      this.set("captcha-loading", "\u6B63\u5728\u83B7\u53D6\u9A8C\u8BC1\u7801", { image: void 0, nextCheck: void 0, remaining: void 0, checking: false });
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!this.valid(g) || !this.allowed()) return;
        try {
          const image = await this.api.captcha();
          if (this.valid(g)) {
            this.set("input", "\u8F93\u5165\u9A8C\u8BC1\u7801\u540E\u6309\u56DE\u8F66\u6216\u70B9\u51FB\u63D0\u4EA4", { image });
            if (this.mode === "ocr") void this.recognize(image);
          }
          return;
        } catch (error) {
          if (!this.valid(g)) return;
          if (!(error instanceof ApiError) || error.kind !== "network" || attempt === 2) {
            this.set("failed", message(error));
            return;
          }
          this.set("captcha-loading", "\u53D6\u56FE\u8FDE\u63A5\u5931\u8D25\uFF0C\u7A0D\u540E\u91CD\u8BD5");
          await this.wait((attempt + 1) * 1e3);
        }
      }
    }
    async submit(code) {
      if (this.state.phase !== "input" || !this.state.activity || !this.allowed()) return;
      if (!this.bookable()) return;
      if (fullCapacity(this.state)) {
        this.offerMonitor();
        return;
      }
      if (!controls(this.state, this.now()).submit) return;
      code = code.trim();
      if (!code || code.length > 4) {
        this.set("input", "\u8BF7\u8F93\u5165 1\u20134 \u4F4D\u9A8C\u8BC1\u7801");
        return;
      }
      if (this.now() + this.offset >= this.state.activity.endsAt) {
        this.set("failed", "\u9884\u7EA6\u65F6\u95F4\u5DF2\u7ED3\u675F");
        return;
      }
      const g = this.generation;
      this.set("submitting", "\u6B63\u5728\u63D0\u4EA4\uFF0C\u8BF7\u52FF\u91CD\u590D\u64CD\u4F5C");
      try {
        await this.api.submit(this.state.activity.id, code);
      } catch (error) {
        if (!this.valid(g)) return;
        if (error instanceof ApiError && error.kind === "business") {
          if (error.message.includes("\u9A8C\u8BC1\u7801")) {
            if (this.mode === "ocr") this.manual("\u9A8C\u8BC1\u7801\u672A\u901A\u8FC7\uFF0C\u8BF7\u624B\u52A8\u8F93\u5165\u65B0\u9A8C\u8BC1\u7801");
            this.set("input", error.message, { image: void 0 });
            await this.loadCaptcha();
            if (this.state.phase === "input") this.set("input", error.message + " \u5DF2\u66F4\u65B0\u9A8C\u8BC1\u7801");
          } else if (error.message.includes("\u4EBA\u6570\u5DF2\u6EE1")) {
            const continueMonitoring = this.state.taskMode === "monitor" || this.state.followUp;
            this.offerMonitor(error.message);
            if (continueMonitoring) this.scheduleMonitor(this.jitter(), "\u540D\u989D\u5DF2\u6EE1\uFF0C\u7EE7\u7EED\u7B49\u5F85\u7A7A\u4F59\u540D\u989D");
          } else this.set("failed", error.message);
          return;
        }
      }
      if (this.valid(g)) await this.verify();
    }
    async verify() {
      if (!this.state.activity || !["submitting", "unknown", "verifying"].includes(this.state.phase)) return;
      if (this.state.phase === "verifying") return;
      const g = this.generation;
      this.set("verifying", "\u6B63\u5728\u67E5\u8BE2\u9884\u7EA6\u8BB0\u5F55");
      let detail = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!this.valid(g)) return;
        if (attempt) await this.wait(attempt * 1e3);
        if (!this.valid(g)) return;
        try {
          if (await this.api.booked(this.state.activity.id)) {
            if (this.valid(g)) this.set("success", "\u9884\u7EA6\u6210\u529F\uFF0C\u5DF2\u6838\u9A8C\u9884\u7EA6\u8BB0\u5F55", { activity: { ...this.state.activity, reserved: true } });
            return;
          }
          detail = "\u6682\u672A\u67E5\u5230\u9884\u7EA6\u8BB0\u5F55";
        } catch (error) {
          detail = message(error);
          if (error instanceof ApiError && ["session", "rate"].includes(error.kind)) break;
        }
      }
      if (this.valid(g)) this.set("unknown", "\u7ED3\u679C\u5F85\u786E\u8BA4\uFF1A" + detail + "\u3002\u8BF7\u91CD\u65B0\u6838\u9A8C\uFF0C\u4E0D\u8981\u76F4\u63A5\u91CD\u590D\u63D0\u4EA4\u3002");
    }
    bookable() {
      const item = this.state.activity;
      if (!item) return false;
      if (item.reserved) {
        this.set("success", "\u8BE5\u6D3B\u52A8\u5DF2\u6709\u9884\u7EA6\u8BB0\u5F55", { image: void 0 });
        return false;
      }
      if (item.cancelled || this.now() + this.offset >= item.endsAt) {
        this.set("failed", item.cancelled ? "\u6D3B\u52A8\u5DF2\u53D6\u6D88" : "\u9884\u7EA6\u65F6\u95F4\u5DF2\u7ED3\u675F", { image: void 0 });
        return false;
      }
      return true;
    }
    offerMonitor(error) {
      this.cancelPending();
      this.set("ready", error ?? "\u9009\u62E9\u9884\u7EA6\u65B9\u5F0F\u540E\u5F00\u59CB", {
        taskMode: "monitor",
        ...this.inputForTask("monitor"),
        full: true,
        error: Boolean(error),
        image: void 0,
        nextCheck: void 0,
        remaining: void 0,
        checking: false,
        retryAt: void 0,
        activity: error && this.state.activity ? { ...this.state.activity, countKnown: false } : this.state.activity
      });
      void this.prepareOcr();
    }
    cancelPending() {
      ++this.generation;
      ++this.ocrEpoch;
      clearTimeout(this.timer);
      this.wake?.();
      this.wake = void 0;
    }
    close() {
      if (["submitting", "verifying"].includes(this.state.phase)) return false;
      this.cancelPending();
      this.set("closed", "");
      return true;
    }
  };
  function message(error) {
    return error instanceof Error ? error.message : "\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5";
  }

  // src/dialog.ts
  function duration(ms2) {
    const seconds = Math.max(0, Math.ceil(ms2 / 1e3));
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((x) => String(x).padStart(2, "0")).join(":");
  }
  var Dialog = class {
    host = document.createElement("div");
    root = this.host.attachShadow({ mode: "open" });
    panel;
    title;
    info;
    status;
    clock;
    image;
    input;
    submit;
    refresh;
    verify;
    reload;
    close;
    modes;
    preparation;
    modeHint;
    capacity;
    checked;
    taskModes;
    interval;
    followUp;
    start;
    pause;
    shrink;
    checkNow;
    lastPhase;
    lastImage;
    constructor(actions) {
      this.host.id = "seu-lecture-helper-dialog";
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
</style><dialog aria-labelledby="title"><h2 id="title">\u8BB2\u5EA7\u9884\u7EA6</h2><p id="info"></p><p id="status" role="status" aria-live="polite"></p><p class="clock" hidden></p><fieldset><legend>\u9A8C\u8BC1\u7801\u65B9\u5F0F</legend><div class="segments"><label><input type="radio" name="mode" value="ocr"><span><svg aria-hidden="true" viewBox="0 0 20 20"><rect x="5" y="5" width="10" height="10" rx="2"/><path d="M8 2v3m4-3v3M8 15v3m4-3v3M2 8h3m-3 4h3m10-4h3m-3 4h3"/></svg>\u81EA\u52A8\u8BC6\u522B</span></label><label><input type="radio" name="mode" value="manual"><span><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m4 13 9-9 3 3-9 9-4 1 1-4Zm7-7 3 3"/></svg>\u624B\u52A8\u8F93\u5165</span></label></div></fieldset><p id="mode-hint"></p><p id="preparation" aria-live="polite" hidden></p><form><div class="challenge" hidden><img alt="\u9884\u7EA6\u9A8C\u8BC1\u7801"><label><span class="sr-only">\u9A8C\u8BC1\u7801</span><input placeholder="\u9A8C\u8BC1\u7801" aria-label="\u9A8C\u8BC1\u7801" maxlength="4" autocomplete="off" spellcheck="false"></label></div><div class="actions"><button type="submit" class="primary" hidden>\u63D0\u4EA4\u9884\u7EA6</button><button type="button" id="refresh" hidden>\u6362\u4E00\u5F20</button><button type="button" id="verify" hidden>\u91CD\u65B0\u6838\u9A8C</button><button type="button" id="close">\u5173\u95ED</button></div></form></dialog>`;
      const get = (selector) => this.root.querySelector(selector);
      this.panel = get("dialog");
      this.title = get("#title");
      this.info = get("#info");
      this.status = get("#status");
      this.clock = get(".clock");
      this.image = get("img");
      this.input = get('input[aria-label="\u9A8C\u8BC1\u7801"]');
      this.submit = get("[type=submit]");
      this.refresh = get("#refresh");
      this.verify = get("#verify");
      this.close = get("#close");
      this.modes = [...this.root.querySelectorAll("[name=mode]")];
      this.preparation = get("#preparation");
      this.modeHint = get("#mode-hint");
      this.capacity = document.createElement("p");
      this.capacity.id = "capacity";
      this.info.after(this.capacity);
      const taskOptions = document.createElement("fieldset");
      taskOptions.innerHTML = `<legend>\u9884\u7EA6\u65B9\u5F0F</legend><div class="segments"><label><input type="radio" name="task-mode" value="scheduled"><span>\u5B9A\u65F6\u9884\u7EA6</span></label><label><input type="radio" name="task-mode" value="monitor"><span>\u4F59\u4F4D\u76D1\u6D4B</span></label></div>`;
      this.status.before(taskOptions);
      this.taskModes = [...taskOptions.querySelectorAll("input")];
      this.taskModes.forEach((input) => input.onchange = () => {
        if (input.checked) actions.configure?.({ taskMode: input.value });
      });
      this.checked = document.createElement("p");
      this.checked.id = "checked";
      this.clock.after(this.checked);
      const clockLabel = document.createElement("p");
      clockLabel.id = "clock-label";
      clockLabel.hidden = true;
      this.clock.before(clockLabel);
      const options = document.createElement("div");
      options.id = "monitor-options";
      options.innerHTML = `<label for="interval">\u68C0\u67E5\u95F4\u9694</label><select id="interval" aria-label="\u68C0\u67E5\u95F4\u9694"><option value="30">\u6BCF 30 \u79D2</option><option value="60">\u6BCF 60 \u79D2</option><option value="120">\u6BCF 120 \u79D2</option></select>`;
      this.checked.after(options);
      this.interval = get("#interval");
      this.interval.onchange = () => actions.configure?.({ interval: Number(this.interval.value) });
      const follow = document.createElement("label");
      follow.id = "follow-option";
      follow.innerHTML = `<input type="checkbox" id="follow-up">\u672A\u62A2\u5230\u65F6\u7EE7\u7EED\u76D1\u6D4B\u4F59\u4F4D`;
      options.after(follow);
      this.followUp = get("#follow-up");
      this.followUp.onchange = () => actions.configure?.({ followUp: this.followUp.checked });
      const button = (id, text, action) => {
        const b = document.createElement("button");
        b.id = id;
        b.type = "button";
        b.textContent = text;
        b.hidden = true;
        b.onclick = action;
        this.close.before(b);
        return b;
      };
      this.start = button("start", "\u5F00\u59CB\u7B49\u5F85", () => actions.start?.());
      this.start.className = "primary";
      this.pause = button("pause", "\u6682\u505C\u76D1\u6D4B", () => actions.pause?.());
      this.shrink = button("shrink", "\u6536\u8D77", () => actions.hide?.());
      this.reload = document.createElement("button");
      this.reload.type = "button";
      this.reload.id = "reload";
      this.reload.textContent = "\u5237\u65B0\u5B66\u6821\u9875\u9762";
      this.reload.hidden = true;
      const controls2 = document.createElement("div");
      controls2.className = "controls";
      controls2.append(taskOptions, this.modes[0].closest("fieldset"));
      const overview = document.createElement("div");
      overview.className = "overview";
      const summary = document.createElement("div");
      summary.className = "summary";
      summary.append(this.capacity, this.checked);
      const countdown = document.createElement("div");
      countdown.append(clockLabel, this.clock);
      overview.append(summary, countdown);
      const preferences = document.createElement("div");
      preferences.className = "preferences";
      preferences.append(follow, options);
      this.info.after(controls2, overview, this.status, preferences, this.modeHint, this.preparation);
      this.reload.title = "\u91CD\u65B0\u52A0\u8F7D\u5B66\u6821\u9875\u9762\uFF0C\u4F7F\u539F\u9884\u7EA6\u6309\u94AE\u4E0E\u670D\u52A1\u5668\u72B6\u6001\u540C\u6B65";
      this.close.before(this.reload);
      this.reload.onclick = () => actions.reload?.();
      this.checkNow = button("check-now", "\u7ACB\u5373\u68C0\u67E5", () => actions.checkNow?.());
      const taskActions = document.createElement("div");
      taskActions.className = "task-actions";
      this.close.before(taskActions);
      taskActions.append(this.checkNow, this.close);
      this.modes.forEach((input) => input.onchange = () => {
        if (input.checked) actions.mode?.(input.value);
      });
      get("form").addEventListener("submit", (event) => {
        event.preventDefault();
        if (!this.submit.disabled && !this.submit.hidden) actions.submit(this.input.value);
      });
      this.input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && event.isComposing) event.preventDefault();
      });
      this.refresh.onclick = () => actions.refresh();
      this.verify.onclick = () => actions.verify();
      this.close.onclick = () => actions.close();
      this.panel.addEventListener("cancel", (event) => {
        event.preventDefault();
        actions.close();
      });
      document.body.append(this.host);
      this.panel.showModal();
    }
    render(state) {
      const { activity: activity2, phase } = state;
      const allowed = controls(state);
      if (!this.panel.open && !["waiting", "monitoring", "paused", "ready", "closed"].includes(phase)) this.show();
      this.title.textContent = activity2?.title ?? "\u8BB2\u5EA7\u9884\u7EA6";
      this.info.textContent = activity2 ? `${activity2.category} \xB7 ${activity2.place}
\u5F00\u653E\u65F6\u95F4\uFF1A${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(activity2.startsAt)}` : "";
      this.info.style.whiteSpace = "pre-line";
      this.status.textContent = state.message;
      const routine = ["ready", "waiting", "recognizing", "captcha-loading"].includes(phase) || phase === "input" && state.message.startsWith("\u8F93\u5165\u9A8C\u8BC1\u7801") || phase === "paused" && state.message === "\u76D1\u6D4B\u5DF2\u6682\u505C" || phase === "monitoring" && (state.checking || state.message === "\u6B63\u5728\u7B49\u5F85\u7A7A\u4F59\u540D\u989D" || state.message.startsWith("\u7B49\u5F85\u9884\u7EA6\u5F00\u653E") || state.message.startsWith("\u540D\u989D\u5DF2\u6EE1"));
      this.status.className = routine && !state.error ? "sr-only" : "";
      const monitor = state.taskMode === "monitor";
      this.capacity.hidden = !activity2;
      this.capacity.textContent = activity2 ? knownCount(activity2) ? `${activity2.count} / ${activity2.capacity}` : "\u2014 / \u2014" : "";
      this.taskModes.forEach((input) => {
        input.checked = input.value === (state.taskMode ?? "scheduled");
        input.disabled = !allowed[input.value];
      });
      this.interval.value = String(state.interval ?? 60);
      this.interval.disabled = !allowed.interval;
      this.root.querySelector("#monitor-options").hidden = !monitor && !state.followUp;
      this.followUp.checked = Boolean(state.followUp);
      this.followUp.disabled = !allowed.followUp;
      this.root.querySelector("#follow-option").hidden = monitor || !["ready", "waiting"].includes(phase);
      this.clock.hidden = phase !== "waiting" && !(phase === "monitoring" && state.nextCheck);
      this.clock.textContent = duration(state.remaining ?? 0);
      this.clock.setAttribute("aria-label", monitor ? "\u8DDD\u79BB\u4E0B\u6B21\u68C0\u67E5" : "\u8DDD\u79BB\u9884\u7EA6\u5F00\u653E");
      const clockLabel = this.root.querySelector("#clock-label");
      clockLabel.hidden = this.clock.hidden;
      clockLabel.textContent = monitor ? "\u4E0B\u6B21\u68C0\u67E5\u5012\u8BA1\u65F6" : "\u8DDD\u79BB\u9884\u7EA6\u5F00\u653E";
      this.checked.hidden = !monitor;
      this.checked.textContent = state.lastChecked ? `\u4E0A\u6B21\u68C0\u67E5 ${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(state.lastChecked)}` : "\u5C1A\u672A\u68C0\u67E5";
      this.start.hidden = !["ready", "paused"].includes(phase);
      this.start.disabled = !allowed.start;
      this.start.textContent = phase === "paused" ? "\u7EE7\u7EED\u76D1\u6D4B" : monitor ? "\u5F00\u59CB\u76D1\u6D4B" : activity2 && activity2.startsAt <= Date.now() + (state.offset ?? 0) ? "\u7ACB\u5373\u9884\u7EA6" : "\u5F00\u59CB\u7B49\u5F85";
      this.pause.hidden = phase !== "monitoring";
      this.shrink.hidden = !["waiting", "monitoring"].includes(phase);
      this.checkNow.hidden = !monitor || phase !== "monitoring";
      this.checkNow.disabled = !allowed.checkNow;
      this.checkNow.setAttribute("aria-busy", String(Boolean(state.checking)));
      this.close.textContent = monitor && ["monitoring", "paused"].includes(phase) ? "\u505C\u6B62\u76D1\u6D4B" : "\u5173\u95ED";
      const mode = state.mode ?? "manual";
      this.modes.forEach((input) => {
        input.checked = input.value === mode;
        input.disabled = input.value === "manual" ? !allowed.manual : !allowed.mode;
      });
      this.modeHint.textContent = mode === "ocr" ? "\u672C\u5730\u8BC6\u522B\u540E\u81EA\u52A8\u63D0\u4EA4\uFF1B\u5F02\u5E38\u65F6\u8F6C\u4E3A\u624B\u52A8\u8F93\u5165\u3002" : "\u81EA\u884C\u8F93\u5165\u9A8C\u8BC1\u7801\uFF0C\u6309\u56DE\u8F66\u6216\u70B9\u51FB\u6309\u94AE\u63D0\u4EA4\u3002";
      this.preparation.hidden = state.ocrStatus !== "failed";
      this.preparation.dataset.status = state.ocrStatus ?? "";
      this.preparation.textContent = state.ocrStatus === "ready" ? "OCR \u5DF2\u5C31\u7EEA" : state.ocrMessage ?? "";
      const editable = allowed.submit;
      this.root.querySelector(".challenge").hidden = !state.image || !["input", "recognizing"].includes(phase);
      this.submit.hidden = !editable;
      this.submit.disabled = !editable;
      this.input.disabled = !editable;
      this.refresh.hidden = !editable;
      this.refresh.textContent = phase === "failed" ? "\u91CD\u65B0\u83B7\u53D6\u9A8C\u8BC1\u7801" : "\u6362\u4E00\u5F20";
      this.verify.hidden = phase !== "unknown";
      this.reload.hidden = phase !== "success";
      this.close.disabled = phase === "submitting" || phase === "verifying";
      this.close.title = this.close.disabled ? "\u63D0\u4EA4\u548C\u6838\u9A8C\u5B8C\u6210\u540E\u53EF\u5173\u95ED\uFF1B\u5173\u95ED\u4E0D\u80FD\u64A4\u9500\u9884\u7EA6" : "";
      const changedImage = state.image !== this.lastImage;
      if (changedImage) {
        this.lastImage = state.image;
        this.input.value = "";
        if (state.image) this.image.src = state.image;
        else this.image.removeAttribute("src");
      }
      if (editable && (changedImage || this.lastPhase !== "input")) this.input.focus();
      this.lastPhase = phase;
    }
    hide() {
      this.panel.close();
    }
    show() {
      if (!this.panel.open) this.panel.showModal();
    }
    destroy() {
      this.panel.close();
      this.host.remove();
    }
  };

  // src/lock.ts
  async function acquireTask(locks = navigator.locks) {
    if (!locks) throw new Error("\u5F53\u524D\u6D4F\u89C8\u5668\u4E0D\u652F\u6301\u4EFB\u52A1\u4E92\u65A5\uFF0C\u8BF7\u4F7F\u7528\u65B0\u7248 Chrome \u6216 Edge");
    return new Promise((resolve, reject) => {
      void locks.request("seu-lecture-helper:reservation", { ifAvailable: true }, async (lock) => {
        if (!lock) {
          resolve(null);
          return;
        }
        await new Promise((release) => resolve(release));
      }).catch(reject);
    });
  }

  // src/mount.ts
  var BUTTON = "seu-lecture-helper-button";
  function componentId(card) {
    let vm = card.__vue__;
    for (let i = 0; vm && i < 8; i++, vm = vm.$parent) {
      const item = vm.$props?.item;
      if (item?.WID) return String(item.WID);
    }
  }
  function matchCard(card, items) {
    const direct = componentId(card);
    if (direct) return direct;
    const title = card.querySelector(".activity-name [title]")?.getAttribute("title");
    const details = card.querySelectorAll(".activity-text");
    const place = details[details.length - 1]?.textContent?.trim();
    const times = details[1]?.querySelector("[title]")?.getAttribute("title")?.replace(/\D/g, "");
    const matches = items.filter((x) => x.title === title && x.place === place && (x.eventStart + x.eventEnd).replace(/\D/g, "") === times);
    return matches.length === 1 ? matches[0].id : void 0;
  }
  function visible(element) {
    for (let e = element; e; e = e.parentElement) {
      if (e.hasAttribute("hidden") || e.getAttribute("aria-hidden") === "true") return false;
      const style = getComputedStyle(e);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return true;
  }
  var Mount = class {
    constructor(api, open, routeChange = () => {
    }) {
      this.api = api;
      this.open = open;
      this.routeChange = routeChange;
    }
    items = [];
    reservationUpdates = /* @__PURE__ */ new Map();
    active;
    observer;
    timer;
    epoch = 0;
    stopped = false;
    route = () => {
      this.routeChange();
      this.remove();
      this.items = [];
      void this.load();
    };
    remove() {
      document.querySelectorAll("." + BUTTON).forEach((x) => x.remove());
    }
    start() {
      this.stopped = false;
      this.observer = new MutationObserver(() => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.scan(), 50);
      });
      this.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden"] });
      window.addEventListener("hashchange", this.route);
      void this.load();
    }
    async load() {
      const epoch = ++this.epoch;
      this.reservationUpdates.clear();
      this.scan();
      if (!/^#\/(hdyy|hdxq)(?:\?|$)/.test(location.hash)) return;
      try {
        const data = await this.api.list();
        if (!this.stopped && epoch === this.epoch) {
          this.items = data.activities;
          this.scan();
        }
      } catch {
        if (!this.stopped && epoch === this.epoch) this.scan();
      }
    }
    setReserved(id, reserved) {
      if (this.reservationUpdates.get(id) === reserved) return;
      this.reservationUpdates.set(id, reserved);
      this.scan();
    }
    setActive(id, label = "") {
      if (this.active?.id === id && this.active?.label === label) return;
      this.active = id && label ? { id, label } : void 0;
      this.scan();
    }
    scan() {
      if (this.stopped) return;
      const targets = [];
      const route = location.hash.split("?")[0];
      if (route === "#/hdyy") {
        const selected = document.querySelector(".hdyy .mint-navbar .is-selected");
        if (!selected || selected.textContent?.trim() === "\u6D3B\u52A8\u5217\u8868") {
          document.querySelectorAll(".activity-container").forEach((card) => {
            if (!visible(card)) return;
            const id = matchCard(card, this.items);
            const parent = card.querySelector(".activity-content .ydd-inline-flex.ydd-pull-right.ydd-pt-14");
            if (id && parent) targets.push({ parent, id });
          });
        }
      } else if (route === "#/hdxq") {
        const id = new URLSearchParams(location.hash.split("?")[1] ?? "").get("WID");
        const parent = [...document.querySelectorAll(".hdxq-foot")].find(visible);
        if (id && parent) targets.push({ parent, id });
      }
      const parents = new Set(targets.map((x) => x.parent));
      document.querySelectorAll("." + BUTTON).forEach((button) => {
        if (!button.parentElement || !parents.has(button.parentElement)) button.remove();
      });
      for (const { parent, id } of targets) {
        let button = parent.querySelector("." + BUTTON);
        if (button?.dataset.activityId !== id) {
          button?.remove();
          button = document.createElement("button");
          button.type = "button";
          button.className = BUTTON;
          button.dataset.activityId = id;
          button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.open(id);
          });
          parent.append(button);
        }
        const reserved = this.reservationUpdates.get(id) ?? this.items.find((item) => item.id === id)?.reserved ?? false;
        const label = reserved ? "\u5DF2\u9884\u7EA6" : this.active?.id === id ? this.active.label : "\u9884\u7EA6\u52A9\u624B";
        if (button.textContent !== label) button.textContent = label;
        button.dataset.reserved = String(reserved);
        button.title = reserved ? "\u5DF2\u786E\u8BA4\u9884\u7EA6\uFF1B\u70B9\u51FB\u53EF\u91CD\u65B0\u67E5\u8BE2\u5F53\u524D\u72B6\u6001" : "\u6253\u5F00\u9884\u7EA6\u52A9\u624B";
        const native = [...parent.querySelectorAll("button")].find((x) => x !== button && visible(x));
        const sizeClass = native && [...native.classList].find((x) => /^ydd-button-(small|large|min)$/.test(x));
        const className = BUTTON + (sizeClass ? " " + sizeClass : "");
        if (button.className !== className) button.className = className;
        const style = document.createElement("button").style;
        style.cssText = "margin-left:10px;box-sizing:border-box;border:1px solid #287547;background:#f0f8f2;color:#24663b;cursor:pointer;white-space:nowrap;flex-shrink:0";
        if (native) {
          const computed = getComputedStyle(native);
          for (const property of ["font-family", "font-size", "font-weight", "line-height", "padding-top", "padding-right", "padding-bottom", "padding-left", "border-radius", "border-width"]) style.setProperty(property, computed.getPropertyValue(property));
          const bounds = native.getBoundingClientRect();
          if (bounds.height) style.height = `${bounds.height}px`;
          if (bounds.width && native.textContent?.trim().length === 4) style.width = `${bounds.width}px`;
        } else {
          style.padding = "5px 12px";
          style.borderRadius = "18px";
          style.fontSize = "14px";
        }
        if (button.style.cssText !== style.cssText) button.style.cssText = style.cssText;
      }
    }
    stop() {
      this.stopped = true;
      ++this.epoch;
      this.observer?.disconnect();
      clearTimeout(this.timer);
      window.removeEventListener("hashchange", this.route);
      this.remove();
    }
  };

  // node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs
  /*!
   * ONNX Runtime Web v1.30.0
   * Copyright (c) Microsoft Corporation. All rights reserved.
   * Licensed under the MIT License.
   */
  var qt = Object.defineProperty;
  var Qa = Object.getOwnPropertyDescriptor;
  var Ka = Object.getOwnPropertyNames;
  var es = Object.prototype.hasOwnProperty;
  var Jt = ((n) => typeof __require < "u" ? __require : typeof Proxy < "u" ? new Proxy(n, { get: (t, a) => (typeof __require < "u" ? __require : t)[a] }) : n)(function(n) {
    if (typeof __require < "u") return __require.apply(this, arguments);
    throw Error('Dynamic require of "' + n + '" is not supported');
  });
  var N = (n, t, a) => () => {
    if (a) throw a[0];
    try {
      return n && (t = n(n = 0)), t;
    } catch (u) {
      throw a = [u], u;
    }
  };
  var ut = (n, t) => {
    for (var a in t) qt(n, a, { get: t[a], enumerable: true });
  };
  var ts = (n, t, a, u) => {
    if (t && typeof t == "object" || typeof t == "function") for (let o of Ka(t)) !es.call(n, o) && o !== a && qt(n, o, { get: () => t[o], enumerable: !(u = Qa(t, o)) || u.enumerable });
    return n;
  };
  var Xt = (n) => ts(qt({}, "__esModule", { value: true }), n);
  var ft;
  var Be;
  var Je;
  var ns;
  var pr;
  var Zt = N(() => {
    "use strict";
    ft = /* @__PURE__ */ new Map(), Be = [], Je = (n, t, a) => {
      if (t && typeof t.init == "function" && typeof t.createInferenceSessionHandler == "function") {
        let u = ft.get(n);
        if (u === void 0) ft.set(n, { backend: t, priority: a });
        else {
          if (u.priority > a) return;
          if (u.priority === a && u.backend !== t) throw new Error(`cannot register backend "${n}" using priority ${a}`);
        }
        if (a >= 0) {
          let o = Be.indexOf(n);
          o !== -1 && Be.splice(o, 1);
          for (let d = 0; d < Be.length; d++) if (ft.get(Be[d]).priority <= a) {
            Be.splice(d, 0, n);
            return;
          }
          Be.push(n);
        }
        return;
      }
      throw new TypeError("not a valid backend");
    }, ns = async (n) => {
      let t = ft.get(n);
      if (!t) return "backend not found.";
      if (t.initialized) return t.backend;
      if (t.aborted) return t.error;
      {
        let a = !!t.initPromise;
        try {
          return a || (t.initPromise = t.backend.init(n)), await t.initPromise, t.initialized = true, t.backend;
        } catch (u) {
          return a || (t.error = `${u}`, t.aborted = true), t.error;
        } finally {
          delete t.initPromise;
        }
      }
    }, pr = async (n) => {
      let t = n.executionProviders || [], a = t.map((m) => typeof m == "string" ? m : m.name), u = a.length === 0 ? Be : a, o, d = [], c = /* @__PURE__ */ new Set();
      for (let m of u) {
        let h = await ns(m);
        typeof h == "string" ? d.push({ name: m, err: h }) : (o || (o = h), o === h && c.add(m));
      }
      if (!o) throw new Error(`no available backend found. ERR: ${d.map((m) => `[${m.name}] ${m.err}`).join(", ")}`);
      for (let { name: m, err: h } of d) a.includes(m) && console.warn(`removing requested execution provider "${m}" from session options because it is not available: ${h}`);
      let l = t.filter((m) => c.has(typeof m == "string" ? m : m.name));
      return [o, new Proxy(n, { get: (m, h) => h === "executionProviders" ? l : Reflect.get(m, h) })];
    };
  });
  var mr = N(() => {
    "use strict";
    Zt();
  });
  var hr;
  var wr = N(() => {
    "use strict";
    hr = "1.30.0";
  });
  var br;
  var q;
  var Qt = N(() => {
    "use strict";
    wr();
    br = "warning", q = { wasm: {}, webgl: {}, webgpu: {}, versions: { common: hr }, set logLevel(n) {
      if (n !== void 0) {
        if (typeof n != "string" || ["verbose", "info", "warning", "error", "fatal"].indexOf(n) === -1) throw new Error(`Unsupported logging level: ${n}`);
        br = n;
      }
    }, get logLevel() {
      return br;
    } };
    Object.defineProperty(q, "logLevel", { enumerable: true });
  });
  var Y;
  var yr = N(() => {
    "use strict";
    Qt();
    Y = q;
  });
  var gr;
  var Er;
  var Tr = N(() => {
    "use strict";
    gr = (n, t) => {
      let a = typeof document < "u" ? document.createElement("canvas") : new OffscreenCanvas(1, 1);
      a.width = n.dims[3], a.height = n.dims[2];
      let u = a.getContext("2d");
      if (u != null) {
        let o, d;
        t?.tensorLayout !== void 0 && t.tensorLayout === "NHWC" ? (o = n.dims[2], d = n.dims[3]) : (o = n.dims[3], d = n.dims[2]);
        let c = t?.format !== void 0 ? t.format : "RGB", l = t?.norm, m, h;
        l === void 0 || l.mean === void 0 ? m = [255, 255, 255, 255] : typeof l.mean == "number" ? m = [l.mean, l.mean, l.mean, l.mean] : (m = [l.mean[0], l.mean[1], l.mean[2], 0], l.mean[3] !== void 0 && (m[3] = l.mean[3])), l === void 0 || l.bias === void 0 ? h = [0, 0, 0, 0] : typeof l.bias == "number" ? h = [l.bias, l.bias, l.bias, l.bias] : (h = [l.bias[0], l.bias[1], l.bias[2], 0], l.bias[3] !== void 0 && (h[3] = l.bias[3]));
        let g = d * o, b = 0, y = g, T = g * 2, I = -1;
        c === "RGBA" ? (b = 0, y = g, T = g * 2, I = g * 3) : c === "RGB" ? (b = 0, y = g, T = g * 2) : c === "RBG" && (b = 0, T = g, y = g * 2);
        for (let D = 0; D < d; D++) for (let $ = 0; $ < o; $++) {
          let v = (n.data[b++] - h[0]) * m[0], A = (n.data[y++] - h[1]) * m[1], F = (n.data[T++] - h[2]) * m[2], P = I === -1 ? 255 : (n.data[I++] - h[3]) * m[3];
          u.fillStyle = "rgba(" + v + "," + A + "," + F + "," + P + ")", u.fillRect($, D, 1, 1);
        }
        if ("toDataURL" in a) return a.toDataURL();
        throw new Error("toDataURL is not supported");
      } else throw new Error("Can not access image data");
    }, Er = (n, t) => {
      let a = typeof document < "u" ? document.createElement("canvas").getContext("2d") : new OffscreenCanvas(1, 1).getContext("2d"), u;
      if (a != null) {
        let o, d, c;
        t?.tensorLayout !== void 0 && t.tensorLayout === "NHWC" ? (o = n.dims[2], d = n.dims[1], c = n.dims[3]) : (o = n.dims[3], d = n.dims[2], c = n.dims[1]);
        let l = t !== void 0 && t.format !== void 0 ? t.format : "RGB", m = t?.norm, h, g;
        m === void 0 || m.mean === void 0 ? h = [255, 255, 255, 255] : typeof m.mean == "number" ? h = [m.mean, m.mean, m.mean, m.mean] : (h = [m.mean[0], m.mean[1], m.mean[2], 255], m.mean[3] !== void 0 && (h[3] = m.mean[3])), m === void 0 || m.bias === void 0 ? g = [0, 0, 0, 0] : typeof m.bias == "number" ? g = [m.bias, m.bias, m.bias, m.bias] : (g = [m.bias[0], m.bias[1], m.bias[2], 0], m.bias[3] !== void 0 && (g[3] = m.bias[3]));
        let b = d * o;
        if (t !== void 0 && (t.format !== void 0 && c === 4 && t.format !== "RGBA" || c === 3 && t.format !== "RGB" && t.format !== "BGR")) throw new Error("Tensor format doesn't match input tensor dims");
        let y = 4, T = 0, I = 1, D = 2, $ = 3, v = 0, A = b, F = b * 2, P = -1;
        l === "RGBA" ? (v = 0, A = b, F = b * 2, P = b * 3) : l === "RGB" ? (v = 0, A = b, F = b * 2) : l === "RBG" && (v = 0, F = b, A = b * 2), u = a.createImageData(o, d);
        for (let k = 0; k < d * o; T += y, I += y, D += y, $ += y, k++) u.data[T] = (n.data[v++] - g[0]) * h[0], u.data[I] = (n.data[A++] - g[1]) * h[1], u.data[D] = (n.data[F++] - g[2]) * h[2], u.data[$] = P === -1 ? 255 : (n.data[P++] - g[3]) * h[3];
      } else throw new Error("Can not access image data");
      return u;
    };
  });
  var Kt;
  var Sr;
  var vr;
  var Ar;
  var Or;
  var Ir;
  var Br = N(() => {
    "use strict";
    ct();
    Kt = (n, t) => {
      if (n === void 0) throw new Error("Image buffer must be defined");
      if (t.height === void 0 || t.width === void 0) throw new Error("Image height and width must be defined");
      if (t.tensorLayout === "NHWC") throw new Error("NHWC Tensor layout is not supported yet");
      let { height: a, width: u } = t, o = t.norm ?? { mean: 255, bias: 0 }, d, c;
      typeof o.mean == "number" ? d = [o.mean, o.mean, o.mean, o.mean] : d = [o.mean[0], o.mean[1], o.mean[2], o.mean[3] ?? 255], typeof o.bias == "number" ? c = [o.bias, o.bias, o.bias, o.bias] : c = [o.bias[0], o.bias[1], o.bias[2], o.bias[3] ?? 0];
      let l = t.format !== void 0 ? t.format : "RGBA", m = t.tensorFormat !== void 0 && t.tensorFormat !== void 0 ? t.tensorFormat : "RGB", h = a * u, g = m === "RGBA" ? new Float32Array(h * 4) : new Float32Array(h * 3), b = 4, y = 0, T = 1, I = 2, D = 3, $ = 0, v = h, A = h * 2, F = -1;
      l === "RGB" && (b = 3, y = 0, T = 1, I = 2, D = -1), m === "RGBA" ? F = h * 3 : m === "RBG" ? ($ = 0, A = h, v = h * 2) : m === "BGR" && (A = 0, v = h, $ = h * 2);
      for (let k = 0; k < h; k++, y += b, I += b, T += b, D += b) g[$++] = (n[y] + c[0]) / d[0], g[v++] = (n[T] + c[1]) / d[1], g[A++] = (n[I] + c[2]) / d[2], F !== -1 && D !== -1 && (g[F++] = (n[D] + c[3]) / d[3]);
      return m === "RGBA" ? new Z("float32", g, [1, 4, a, u]) : new Z("float32", g, [1, 3, a, u]);
    }, Sr = async (n, t) => {
      let a = typeof HTMLImageElement < "u" && n instanceof HTMLImageElement, u = typeof ImageData < "u" && n instanceof ImageData, o = typeof ImageBitmap < "u" && n instanceof ImageBitmap, d = typeof n == "string", c, l = t ?? {}, m = () => {
        if (typeof document < "u") return document.createElement("canvas");
        if (typeof OffscreenCanvas < "u") return new OffscreenCanvas(1, 1);
        throw new Error("Canvas is not supported");
      }, h = (g) => typeof HTMLCanvasElement < "u" && g instanceof HTMLCanvasElement || g instanceof OffscreenCanvas ? g.getContext("2d") : null;
      if (a) {
        let g = m();
        g.width = n.width, g.height = n.height;
        let b = h(g);
        if (b != null) {
          let y = n.height, T = n.width;
          if (t !== void 0 && t.resizedHeight !== void 0 && t.resizedWidth !== void 0 && (y = t.resizedHeight, T = t.resizedWidth), t !== void 0) {
            if (l = t, t.tensorFormat !== void 0) throw new Error("Image input config format must be RGBA for HTMLImageElement");
            l.tensorFormat = "RGBA", l.height = y, l.width = T;
          } else l.tensorFormat = "RGBA", l.height = y, l.width = T;
          b.drawImage(n, 0, 0), c = b.getImageData(0, 0, T, y).data;
        } else throw new Error("Can not access image data");
      } else if (u) {
        let g, b;
        if (t !== void 0 && t.resizedWidth !== void 0 && t.resizedHeight !== void 0 ? (g = t.resizedHeight, b = t.resizedWidth) : (g = n.height, b = n.width), t !== void 0 && (l = t), l.format = "RGBA", l.height = g, l.width = b, t !== void 0) {
          let y = m();
          y.width = b, y.height = g;
          let T = h(y);
          if (T != null) T.putImageData(n, 0, 0), c = T.getImageData(0, 0, b, g).data;
          else throw new Error("Can not access image data");
        } else c = n.data;
      } else if (o) {
        if (t === void 0) throw new Error("Please provide image config with format for Imagebitmap");
        let g = m();
        g.width = n.width, g.height = n.height;
        let b = h(g);
        if (b != null) {
          let y = n.height, T = n.width;
          return b.drawImage(n, 0, 0, T, y), c = b.getImageData(0, 0, T, y).data, l.height = y, l.width = T, Kt(c, l);
        } else throw new Error("Can not access image data");
      } else {
        if (d) return new Promise((g, b) => {
          let y = m(), T = h(y);
          if (!n || !T) return b();
          let I = new Image();
          I.crossOrigin = "Anonymous", I.src = n, I.onload = () => {
            y.width = I.width, y.height = I.height, T.drawImage(I, 0, 0, y.width, y.height);
            let D = T.getImageData(0, 0, y.width, y.height);
            l.height = y.height, l.width = y.width, g(Kt(D.data, l));
          };
        });
        throw new Error("Input data provided is not supported - aborted tensor creation");
      }
      if (c !== void 0) return Kt(c, l);
      throw new Error("Input data provided is not supported - aborted tensor creation");
    }, vr = (n, t) => {
      let { width: a, height: u, download: o, dispose: d } = t, c = [1, u, a, 4];
      return new Z({ location: "texture", type: "float32", texture: n, dims: c, download: o, dispose: d });
    }, Ar = (n, t) => {
      let { dataType: a, dims: u, download: o, dispose: d } = t;
      return new Z({ location: "gpu-buffer", type: a ?? "float32", gpuBuffer: n, dims: u, download: o, dispose: d });
    }, Or = (n, t) => {
      let { dataType: a, dims: u, download: o, dispose: d } = t;
      return new Z({ location: "ml-tensor", type: a ?? "float32", mlTensor: n, dims: u, download: o, dispose: d });
    }, Ir = (n, t, a) => new Z({ location: "cpu-pinned", type: n, data: t, dims: a ?? [t.length] });
  });
  var Le;
  var Xe;
  var Lr;
  var _r;
  var Dr = N(() => {
    "use strict";
    Le = /* @__PURE__ */ new Map([["float32", Float32Array], ["uint8", Uint8Array], ["int8", Int8Array], ["uint16", Uint16Array], ["int16", Int16Array], ["int32", Int32Array], ["bool", Uint8Array], ["float64", Float64Array], ["uint32", Uint32Array], ["int4", Uint8Array], ["uint4", Uint8Array]]), Xe = /* @__PURE__ */ new Map([[Float32Array, "float32"], [Uint8Array, "uint8"], [Int8Array, "int8"], [Uint16Array, "uint16"], [Int16Array, "int16"], [Int32Array, "int32"], [Float64Array, "float64"], [Uint32Array, "uint32"]]), Lr = false, _r = () => {
      if (!Lr) {
        Lr = true;
        let n = typeof BigInt64Array < "u" && BigInt64Array.from, t = typeof BigUint64Array < "u" && BigUint64Array.from, a = globalThis.Float16Array, u = typeof a < "u" && a.from;
        n && (Le.set("int64", BigInt64Array), Xe.set(BigInt64Array, "int64")), t && (Le.set("uint64", BigUint64Array), Xe.set(BigUint64Array, "uint64")), u ? (Le.set("float16", a), Xe.set(a, "float16")) : Le.set("float16", Uint16Array);
      }
    };
  });
  var Pr;
  var Ur;
  var xr = N(() => {
    "use strict";
    ct();
    Pr = (n) => {
      let t = 1;
      for (let a = 0; a < n.length; a++) {
        let u = n[a];
        if (typeof u != "number" || !Number.isSafeInteger(u)) throw new TypeError(`dims[${a}] must be an integer, got: ${u}`);
        if (u < 0) throw new RangeError(`dims[${a}] must be a non-negative integer, got: ${u}`);
        t *= u;
      }
      return t;
    }, Ur = (n, t) => {
      switch (n.location) {
        case "cpu":
          return new Z(n.type, n.data, t);
        case "cpu-pinned":
          return new Z({ location: "cpu-pinned", data: n.data, type: n.type, dims: t });
        case "texture":
          return new Z({ location: "texture", texture: n.texture, type: n.type, dims: t });
        case "gpu-buffer":
          return new Z({ location: "gpu-buffer", gpuBuffer: n.gpuBuffer, type: n.type, dims: t });
        case "ml-tensor":
          return new Z({ location: "ml-tensor", mlTensor: n.mlTensor, type: n.type, dims: t });
        default:
          throw new Error(`tensorReshape: tensor location ${n.location} is not supported`);
      }
    };
  });
  var Z;
  var ct = N(() => {
    "use strict";
    Tr();
    Br();
    Dr();
    xr();
    Z = class {
      constructor(t, a, u) {
        _r();
        let o, d;
        if (typeof t == "object" && "location" in t) switch (this.dataLocation = t.location, o = t.type, d = t.dims, t.location) {
          case "cpu-pinned": {
            let l = Le.get(o);
            if (!l) throw new TypeError(`unsupported type "${o}" to create tensor from pinned buffer`);
            if (!(t.data instanceof l)) throw new TypeError(`buffer should be of type ${l.name}`);
            this.cpuData = t.data;
            break;
          }
          case "texture": {
            if (o !== "float32") throw new TypeError(`unsupported type "${o}" to create tensor from texture`);
            this.gpuTextureData = t.texture, this.downloader = t.download, this.disposer = t.dispose;
            break;
          }
          case "gpu-buffer": {
            if (o !== "float32" && o !== "float16" && o !== "int32" && o !== "int64" && o !== "uint32" && o !== "uint8" && o !== "bool" && o !== "uint4" && o !== "int4") throw new TypeError(`unsupported type "${o}" to create tensor from gpu buffer`);
            this.gpuBufferData = t.gpuBuffer, this.downloader = t.download, this.disposer = t.dispose;
            break;
          }
          case "ml-tensor": {
            if (o !== "float32" && o !== "float16" && o !== "int32" && o !== "int64" && o !== "uint32" && o !== "uint64" && o !== "int8" && o !== "uint8" && o !== "bool" && o !== "uint4" && o !== "int4") throw new TypeError(`unsupported type "${o}" to create tensor from MLTensor`);
            this.mlTensorData = t.mlTensor, this.downloader = t.download, this.disposer = t.dispose;
            break;
          }
          default:
            throw new Error(`Tensor constructor: unsupported location '${this.dataLocation}'`);
        }
        else {
          let l, m;
          if (typeof t == "string") if (o = t, m = u, t === "string") {
            if (!Array.isArray(a)) throw new TypeError("A string tensor's data must be a string array.");
            l = a;
          } else {
            let h = Le.get(t);
            if (h === void 0) throw new TypeError(`Unsupported tensor type: ${t}.`);
            if (Array.isArray(a)) {
              if (t === "float16" && h === Uint16Array || t === "uint4" || t === "int4") throw new TypeError(`Creating a ${t} tensor from number array is not supported. Please use ${h.name} as data.`);
              t === "uint64" || t === "int64" ? l = h.from(a, BigInt) : l = h.from(a);
            } else if (a instanceof h) l = a;
            else if (a instanceof Uint8ClampedArray) if (t === "uint8") l = Uint8Array.from(a);
            else throw new TypeError("A Uint8ClampedArray tensor's data must be type of uint8");
            else if (t === "float16" && a instanceof Uint16Array && h !== Uint16Array) l = new globalThis.Float16Array(a.buffer, a.byteOffset, a.length);
            else throw new TypeError(`A ${o} tensor's data must be type of ${h}`);
          }
          else if (m = a, Array.isArray(t)) {
            if (t.length === 0) throw new TypeError("Tensor type cannot be inferred from an empty array.");
            let h = typeof t[0];
            if (h === "string") o = "string", l = t;
            else if (h === "boolean") o = "bool", l = Uint8Array.from(t);
            else throw new TypeError(`Invalid element type of data array: ${h}.`);
          } else if (t instanceof Uint8ClampedArray) o = "uint8", l = Uint8Array.from(t);
          else {
            let h = Xe.get(t.constructor);
            if (h === void 0) throw new TypeError(`Unsupported type for tensor data: ${t.constructor}.`);
            o = h, l = t;
          }
          if (m === void 0) m = [l.length];
          else if (!Array.isArray(m)) throw new TypeError("A tensor's dims must be a number array");
          d = m, this.cpuData = l, this.dataLocation = "cpu";
        }
        let c = Pr(d);
        if (this.cpuData && c !== this.cpuData.length && !((o === "uint4" || o === "int4") && Math.ceil(c / 2) === this.cpuData.length)) throw new Error(`Tensor's size(${c}) does not match data length(${this.cpuData.length}).`);
        this.type = o, this.dims = d, this.size = c;
      }
      static async fromImage(t, a) {
        return Sr(t, a);
      }
      static fromTexture(t, a) {
        return vr(t, a);
      }
      static fromGpuBuffer(t, a) {
        return Ar(t, a);
      }
      static fromMLTensor(t, a) {
        return Or(t, a);
      }
      static fromPinnedBuffer(t, a, u) {
        return Ir(t, a, u);
      }
      toDataURL(t) {
        return gr(this, t);
      }
      toImageData(t) {
        return Er(this, t);
      }
      get data() {
        if (this.ensureValid(), !this.cpuData) throw new Error("The data is not on CPU. Use `getData()` to download GPU data to CPU, or use `texture` or `gpuBuffer` property to access the GPU data directly.");
        return this.cpuData;
      }
      get location() {
        return this.dataLocation;
      }
      get texture() {
        if (this.ensureValid(), !this.gpuTextureData) throw new Error("The data is not stored as a WebGL texture.");
        return this.gpuTextureData;
      }
      get gpuBuffer() {
        if (this.ensureValid(), !this.gpuBufferData) throw new Error("The data is not stored as a WebGPU buffer.");
        return this.gpuBufferData;
      }
      get mlTensor() {
        if (this.ensureValid(), !this.mlTensorData) throw new Error("The data is not stored as a WebNN MLTensor.");
        return this.mlTensorData;
      }
      async getData(t) {
        switch (this.ensureValid(), this.dataLocation) {
          case "cpu":
          case "cpu-pinned":
            return this.data;
          case "texture":
          case "gpu-buffer":
          case "ml-tensor": {
            if (!this.downloader) throw new Error("The current tensor is not created with a specified data downloader.");
            if (this.isDownloading) throw new Error("The current tensor is being downloaded.");
            try {
              this.isDownloading = true;
              let a = await this.downloader();
              return this.downloader = void 0, this.dataLocation = "cpu", this.cpuData = a, t && this.disposer && (this.disposer(), this.disposer = void 0), a;
            } finally {
              this.isDownloading = false;
            }
          }
          default:
            throw new Error(`cannot get data from location: ${this.dataLocation}`);
        }
      }
      dispose() {
        if (this.isDownloading) throw new Error("The current tensor is being downloaded.");
        this.disposer && (this.disposer(), this.disposer = void 0), this.cpuData = void 0, this.gpuTextureData = void 0, this.gpuBufferData = void 0, this.mlTensorData = void 0, this.downloader = void 0, this.isDownloading = void 0, this.dataLocation = "none";
      }
      ensureValid() {
        if (this.dataLocation === "none") throw new Error("The tensor is disposed.");
      }
      reshape(t) {
        if (this.ensureValid(), this.downloader || this.disposer) throw new Error("Cannot reshape a tensor that owns GPU resource.");
        return Ur(this, t);
      }
    };
  });
  var de;
  var en = N(() => {
    "use strict";
    ct();
    de = Z;
  });
  var Cr;
  var Mr;
  var _e;
  var De;
  var Pe;
  var Ue;
  var tn = N(() => {
    "use strict";
    Qt();
    Cr = (n, t) => {
      (typeof q.trace > "u" ? !q.wasm.trace : !q.trace) || console.timeStamp(`${n}::ORT::${t}`);
    }, Mr = (n, t) => {
      let a = new Error().stack?.split(/\r\n|\r|\n/g) || [], u = false;
      for (let o = 0; o < a.length; o++) {
        if (u && !a[o].includes("TRACE_FUNC")) {
          let d = `FUNC_${n}::${a[o].trim().split(" ")[1]}`;
          t && (d += `::${t}`), Cr("CPU", d);
          return;
        }
        a[o].includes("TRACE_FUNC") && (u = true);
      }
    }, _e = (n) => {
      (typeof q.trace > "u" ? !q.wasm.trace : !q.trace) || Mr("BEGIN", n);
    }, De = (n) => {
      (typeof q.trace > "u" ? !q.wasm.trace : !q.trace) || Mr("END", n);
    }, Pe = (n) => {
      (typeof q.trace > "u" ? !q.wasm.trace : !q.trace) || console.time(`ORT::${n}`);
    }, Ue = (n) => {
      (typeof q.trace > "u" ? !q.wasm.trace : !q.trace) || console.timeEnd(`ORT::${n}`);
    };
  });
  var lt;
  var Rr = N(() => {
    "use strict";
    Zt();
    en();
    tn();
    lt = class n {
      constructor(t) {
        this.handler = t;
      }
      async run(t, a, u) {
        _e(), Pe("InferenceSession.run");
        let o = {}, d = {};
        if (typeof t != "object" || t === null || t instanceof de || Array.isArray(t)) throw new TypeError("'feeds' must be an object that use input names as keys and OnnxValue as corresponding values.");
        let c = true;
        if (typeof a == "object") {
          if (a === null) throw new TypeError("Unexpected argument[1]: cannot be null.");
          if (a instanceof de) throw new TypeError("'fetches' cannot be a Tensor");
          if (Array.isArray(a)) {
            if (a.length === 0) throw new TypeError("'fetches' cannot be an empty array.");
            c = false;
            for (let h of a) {
              if (typeof h != "string") throw new TypeError("'fetches' must be a string array or an object.");
              if (this.outputNames.indexOf(h) === -1) throw new RangeError(`'fetches' contains invalid output name: ${h}.`);
              o[h] = null;
            }
            if (typeof u == "object" && u !== null) d = u;
            else if (typeof u < "u") throw new TypeError("'options' must be an object.");
          } else {
            let h = false, g = Object.getOwnPropertyNames(a);
            for (let b of this.outputNames) if (g.indexOf(b) !== -1) {
              let y = a[b];
              (y === null || y instanceof de) && (h = true, c = false, o[b] = y);
            }
            if (h) {
              if (typeof u == "object" && u !== null) d = u;
              else if (typeof u < "u") throw new TypeError("'options' must be an object.");
            } else d = a;
          }
        } else if (typeof a < "u") throw new TypeError("Unexpected argument[1]: must be 'fetches' or 'options'.");
        for (let h of this.inputNames) if (typeof t[h] > "u") throw new Error(`input '${h}' is missing in 'feeds'.`);
        if (c) for (let h of this.outputNames) o[h] = null;
        let l = await this.handler.run(t, o, d), m = {};
        for (let h in l) if (Object.hasOwnProperty.call(l, h)) {
          let g = l[h];
          g instanceof de ? m[h] = g : m[h] = new de(g.type, g.data, g.dims);
        }
        return Ue("InferenceSession.run"), De(), m;
      }
      async release() {
        return this.handler.dispose();
      }
      static async create(t, a, u, o) {
        _e(), Pe("InferenceSession.create");
        let d, c = {};
        if (typeof t == "string") {
          if (d = t, typeof a == "object" && a !== null) c = a;
          else if (typeof a < "u") throw new TypeError("'options' must be an object.");
        } else if (t instanceof Uint8Array) {
          if (d = t, typeof a == "object" && a !== null) c = a;
          else if (typeof a < "u") throw new TypeError("'options' must be an object.");
        } else if (t instanceof ArrayBuffer || typeof SharedArrayBuffer < "u" && t instanceof SharedArrayBuffer) {
          let g = t, b = 0, y = t.byteLength;
          if (typeof a == "object" && a !== null) c = a;
          else if (typeof a == "number") {
            if (b = a, !Number.isSafeInteger(b)) throw new RangeError("'byteOffset' must be an integer.");
            if (b < 0 || b >= g.byteLength) throw new RangeError(`'byteOffset' is out of range [0, ${g.byteLength}).`);
            if (y = t.byteLength - b, typeof u == "number") {
              if (y = u, !Number.isSafeInteger(y)) throw new RangeError("'byteLength' must be an integer.");
              if (y <= 0 || b + y > g.byteLength) throw new RangeError(`'byteLength' is out of range (0, ${g.byteLength - b}].`);
              if (typeof o == "object" && o !== null) c = o;
              else if (typeof o < "u") throw new TypeError("'options' must be an object.");
            } else if (typeof u < "u") throw new TypeError("'byteLength' must be a number.");
          } else if (typeof a < "u") throw new TypeError("'options' must be an object.");
          d = new Uint8Array(g, b, y);
        } else throw new TypeError("Unexpected argument[0]: must be 'path' or 'buffer'.");
        let [l, m] = await pr(c), h = await l.createInferenceSessionHandler(d, m);
        return Ue("InferenceSession.create"), De(), new n(h);
      }
      startProfiling() {
        this.handler.startProfiling();
      }
      endProfiling() {
        this.handler.endProfiling();
      }
      get inputNames() {
        return this.handler.inputNames;
      }
      get outputNames() {
        return this.handler.outputNames;
      }
      get inputMetadata() {
        return this.handler.inputMetadata;
      }
      get outputMetadata() {
        return this.handler.outputMetadata;
      }
    };
  });
  var rs;
  var Fr = N(() => {
    "use strict";
    Rr();
    rs = lt;
  });
  var Nr = N(() => {
    "use strict";
  });
  var kr = N(() => {
    "use strict";
  });
  var Wr = N(() => {
    "use strict";
  });
  var Gr = N(() => {
    "use strict";
  });
  var nn = {};
  ut(nn, { InferenceSession: () => rs, TRACE: () => Cr, TRACE_EVENT_BEGIN: () => Pe, TRACE_EVENT_END: () => Ue, TRACE_FUNC_BEGIN: () => _e, TRACE_FUNC_END: () => De, Tensor: () => de, env: () => Y, registerBackend: () => Je });
  var Te = N(() => {
    "use strict";
    mr();
    yr();
    Fr();
    en();
    Nr();
    kr();
    tn();
    Wr();
    Gr();
  });
  var dt = N(() => {
    "use strict";
  });
  var jr = {};
  ut(jr, { default: () => os });
  var zr;
  var Hr;
  var os;
  var Vr = N(() => {
    "use strict";
    rn();
    xe();
    pt();
    zr = "ort-wasm-proxy-worker", Hr = globalThis.self?.name === zr;
    Hr && (self.onmessage = (n) => {
      let { type: t, in: a } = n.data;
      try {
        switch (t) {
          case "init-wasm":
            mt(a.wasm).then(() => {
              ht(a).then(() => {
                postMessage({ type: t });
              }, (u) => {
                postMessage({ type: t, err: u });
              });
            }, (u) => {
              postMessage({ type: t, err: u });
            });
            break;
          case "init-ep": {
            let { epName: u, env: o } = a;
            wt(o, u).then(() => {
              postMessage({ type: t });
            }, (d) => {
              postMessage({ type: t, err: d });
            });
            break;
          }
          case "copy-from": {
            let { buffer: u } = a, o = Ze(u);
            postMessage({ type: t, out: o });
            break;
          }
          case "create": {
            let { model: u, options: o } = a;
            bt(u, o).then((d) => {
              postMessage({ type: t, out: d });
            }, (d) => {
              postMessage({ type: t, err: d });
            });
            break;
          }
          case "release":
            yt(a), postMessage({ type: t });
            break;
          case "run": {
            let { sessionId: u, inputIndices: o, inputs: d, outputIndices: c, options: l } = a;
            gt(u, o, d, c, new Array(c.length).fill(null), l).then((m) => {
              m.some((h) => h[3] !== "cpu") ? postMessage({ type: t, err: "Proxy does not support non-cpu tensor location." }) : postMessage({ type: t, out: m }, Tt([...d, ...m]));
            }, (m) => {
              postMessage({ type: t, err: m });
            });
            break;
          }
          case "end-profiling":
            Et(a), postMessage({ type: t });
            break;
          default:
        }
      } catch (u) {
        postMessage({ type: t, err: u });
      }
    });
    os = Hr ? null : (n) => new Worker(n ?? oe, { type: "module", name: zr });
  });
  var qr = {};
  ut(qr, { default: () => as });
  async function Yr(n = {}) {
    var t = n, a = !!globalThis.window, u = !!globalThis.WorkerGlobalScope, o = u && self.name?.startsWith("em-pthread");
    t.mountExternalData = (e, r) => {
      e.startsWith("./") && (e = e.substring(2)), (t.Tb || (t.Tb = /* @__PURE__ */ new Map())).set(e, r);
    }, t.unmountExternalData = () => {
      delete t.Tb, delete t.mc, delete t.lc, delete t.nc;
    }, globalThis.SharedArrayBuffer ?? new WebAssembly.Memory({ initial: 0, maximum: 0, shared: true }).buffer.constructor;
    var d, c, l = (e, r) => {
      throw r;
    }, m = void 0, h = "";
    if (a || u) {
      try {
        h = new URL(".", m).href;
      } catch {
      }
      u && (c = (e) => {
        var r = new XMLHttpRequest();
        return r.open("GET", e, false), r.responseType = "arraybuffer", r.send(null), new Uint8Array(r.response);
      }), d = async (e) => {
        if (k(e)) return new Promise((i, s) => {
          var f = new XMLHttpRequest();
          f.open("GET", e, true), f.responseType = "arraybuffer", f.onload = () => {
            f.status == 200 || f.status == 0 && f.response ? i(f.response) : s(f.status);
          }, f.onerror = s, f.send(null);
        });
        var r = await fetch(e, { credentials: "same-origin" });
        if (r.ok) return r.arrayBuffer();
        throw Error(r.status + " : " + r.url);
      };
    }
    var g, b, y, T, I, D, $ = console.log.bind(console), v = console.error.bind(console), A = $, F = v, P = false, k = (e) => e.startsWith("file://");
    function w() {
      ge.buffer != H.buffer && ee();
    }
    if (o) {
      let e = function(r) {
        try {
          var i = r.data, s = i.Rb;
          if (s === "load") {
            let f = [];
            self.onmessage = (p) => f.push(p), D = () => {
              postMessage({ Rb: "loaded" });
              for (let p of f) e(p);
              self.onmessage = e;
            };
            for (let p of i.ac) t[p] && !t[p].proxy || (t[p] = (...E) => {
              postMessage({ Rb: "callHandler", $b: p, args: E });
            }, p == "print" && (A = t[p]), p == "printErr" && (F = t[p]));
            ge = i.fc, ee(), b = i.hc, Ut(), it();
          } else if (s === "run") {
            (function(f) {
              var p = (w(), W)[f + 52 >>> 2 >>> 0];
              f = (w(), W)[f + 56 >>> 2 >>> 0], ir(p, p - f), _(p);
            })(i.Qb), zt(i.Qb, 0, 0, 1, 0, 0), wn(), Ft(i.Qb), Q ||= true;
            try {
              Io(i.dc, i.Vb);
            } catch (f) {
              if (f != "unwind") throw f;
            }
          } else i.target !== "setimmediate" && (s === "checkMailbox" ? Q && rt() : s && (F(`worker: received unknown command ${s}`), F(i)));
        } catch (f) {
          throw nr(), f;
        }
      };
      var As = e, Q = false;
      self.onunhandledrejection = (r) => {
        throw r.reason || r;
      }, self.onmessage = e;
    }
    var H, ne, pe, B, W, re, me, O, K, je = false;
    function ee() {
      var e = ge.buffer;
      t.HEAP8 = H = new Int8Array(e), pe = new Int16Array(e), t.HEAPU8 = ne = new Uint8Array(e), new Uint16Array(e), t.HEAP32 = B = new Int32Array(e), t.HEAPU32 = W = new Uint32Array(e), re = new Float32Array(e), me = new Float64Array(e), O = new BigInt64Array(e), new BigUint64Array(e);
    }
    function he() {
      je = true, o ? D() : Ee.Va();
    }
    function j(e) {
      throw F(e = "Aborted(" + e + ")"), P = true, e = new WebAssembly.RuntimeError(e + ". Build with -sASSERTIONS for more info."), I?.(e), e;
    }
    function J() {
      return { a: { T: ca, f: Bo, w: Lo, e: _o, k: Do, h: Po, L: Uo, b: xo, G: Co, ua: vn, j: Mo, M: In, La: Bn, qa: Ln, sa: _n, Ma: Dn, Ja: Pn, Ca: Un, Ia: xn, Z: Cn, ra: Mn, oa: Rn, Ka: Fn, pa: Nn, Ra: Ro, Fa: Fo, ma: ko, va: Wo, ja: Go, U: $o, Ea: Ft, Oa: zo, za: Ho, Aa: jo, Ba: Vo, xa: $n, ya: zn, ka: Hn, Ta: qo, Qa: Zo, W: Qo, V: Ko, Pa: Jo, F: ea, Na: ta, na, u: Yo, H: ra, S: at, la: aa, ba: oa, Ua: sa, Ga: Yn, Ha: qn, ta: ye, I: Jn, wa: Xn, Y: Zn, Da: Qn, X: Kn, $: Ya, N: $a, aa: Va, O: Ga, v: Da, d: ma, m: da, n: la, r: Aa, ca: Na, E: Fa, o: ba, P: ka, C: za, J: Ra, da: Ma, ea: Ca, z: Oa, fa: Ua, Q: xa, ga: Pa, y: La, D: Wa, c: pa, q: wa, i: ha, _: qa, l: ga, p: Ea, s: ya, t: Ta, x: Ia, R: _a, A: Ha, K: Ba, B: ja, ha: va, ia: Sa, g: ua, a: ge, Sa: V } };
    }
    async function Ut() {
      function e(s, f) {
        return Ee = s.exports, Ee = (function() {
          var p = Ee, E = (C) => () => C() >>> 0, S = (C) => (R) => C(R) >>> 0;
          return (p = Object.assign({}, p)).ub = E(p.ub), p.wb = S(p.wb), p.Kb = S(p.Kb), p.Lb = E(p.Lb), p.Pb = S(p.Pb), p;
        })(), mn.push(Ee.xb), s = Ee, t._OrtInit = s.Wa, t._OrtGetLastError = s.Xa, t._OrtCreateSessionOptions = s.Ya, t._OrtAppendExecutionProvider = s.Za, t._OrtAddFreeDimensionOverride = s._a, t._OrtAddSessionConfigEntry = s.$a, t._OrtReleaseSessionOptions = s.ab, t._OrtCreateSession = s.bb, t._OrtReleaseSession = s.cb, t._OrtGetInputOutputCount = s.db, t._OrtGetInputOutputMetadata = s.eb, t._OrtFree = s.fb, t._OrtCreateTensor = s.gb, t._OrtGetTensorData = s.hb, t._OrtReleaseTensor = s.ib, t._OrtCreateRunOptions = s.jb, t._OrtAddRunConfigEntry = s.kb, t._OrtReleaseRunOptions = s.lb, t._OrtCreateBinding = s.mb, t._OrtBindInput = s.nb, t._OrtBindOutput = s.ob, t._OrtClearBoundOutputs = s.pb, t._OrtReleaseBinding = s.qb, t._OrtRunWithBinding = s.rb, t._OrtRun = s.sb, t._OrtEndProfiling = s.tb, st = s.ub, er = t._free = s.vb, tr = t._malloc = s.wb, zt = s.zb, nr = s.Ab, rr = s.Bb, or = s.Cb, Ht = s.Db, ar = s.Eb, sr = s.Fb, x = s.Gb, qe = s.Hb, ir = s.Ib, _ = s.Jb, jt = s.Kb, U = s.Lb, ur = s.Mb, Vt = s.Nb, fr = s.Ob, cr = s.Pb, lr = s.yb, b = f, Ee;
      }
      var r, i = J();
      return t.instantiateWasm ? new Promise((s) => {
        t.instantiateWasm(i, (f, p) => {
          s(e(f, p));
        });
      }) : o ? e(new WebAssembly.Instance(b, J()), b) : (K ??= t.locateFile ? t.locateFile ? t.locateFile("ort-wasm-simd-threaded.wasm", h) : h + "ort-wasm-simd-threaded.wasm" : new URL("ort-wasm-simd-threaded.wasm", void 0).href, r = await (async function(s) {
        var f = K;
        if (!g && !k(f)) try {
          var p = fetch(f, { credentials: "same-origin" });
          return await WebAssembly.instantiateStreaming(p, s);
        } catch (E) {
          F(`wasm streaming compile failed: ${E}`), F("falling back to ArrayBuffer instantiation");
        }
        return (async function(E, S) {
          try {
            var C = await (async function(R) {
              if (!g) try {
                var X = await d(R);
                return new Uint8Array(X);
              } catch {
              }
              if (R == K && g) R = new Uint8Array(g);
              else {
                if (!c) throw "both async and sync fetching of the wasm failed";
                R = c(R);
              }
              return R;
            })(E);
            return await WebAssembly.instantiate(C, S);
          } catch (R) {
            F(`failed to asynchronously prepare wasm: ${R}`), j(R);
          }
        })(f, s);
      })(i), e(r.instance, r.module));
    }
    class Se {
      name = "ExitStatus";
      constructor(r) {
        this.message = `Program terminated with exit(${r})`, this.status = r;
      }
    }
    var ve = (e) => {
      e.terminate(), e.onmessage = () => {
      };
    }, Ve = [], Re = 0, te = null, ue = (e) => {
      ce.length == 0 && (yn(), bn(ce[0]));
      var r = ce.pop();
      if (!r) return 6;
      Fe.push(r), Ae[e.Qb] = r, r.Qb = e.Qb;
      var i = { Rb: "run", dc: e.cc, Vb: e.Vb, Qb: e.Qb };
      return r.postMessage(i, e.Zb), 0;
    }, se = 0, L = (e, r, ...i) => {
      var s, f = 16 * i.length, p = U(), E = jt(f), S = E >>> 3;
      for (s of i) typeof s == "bigint" ? ((w(), O)[S++ >>> 0] = 1n, (w(), O)[S++ >>> 0] = s) : ((w(), O)[S++ >>> 0] = 0n, (w(), me)[S++ >>> 0] = s);
      return e = rr(e, 0, f, E, r), _(p), e;
    };
    function V(e) {
      if (o) return L(0, 1, e);
      if (y = e, !(0 < se)) {
        for (var r of Fe) ve(r);
        for (r of ce) ve(r);
        ce = [], Fe = [], Ae = {}, P = true;
      }
      l(0, new Se(e));
    }
    function fe(e) {
      if (o) return L(1, 0, e);
      ye(e);
    }
    var ye = (e) => {
      if (y = e, o) throw fe(e), "unwind";
      V(e);
    }, ce = [], Fe = [], mn = [], Ae = {}, hn = (e) => {
      var r = e.Qb;
      delete Ae[r], ce.push(e), Fe.splice(Fe.indexOf(e), 1), e.Qb = 0, or(r);
    };
    function wn() {
      mn.forEach((e) => e());
    }
    var bn = (e) => new Promise((r) => {
      e.onmessage = (f) => {
        var p = f.data;
        if (f = p.Rb, p.Ub && p.Ub != st()) {
          var E = Ae[p.Ub];
          E ? E.postMessage(p, p.Zb) : F(`Internal error! Worker sent a message "${f}" to target pthread ${p.Ub}, but that thread no longer exists!`);
        } else f === "checkMailbox" ? rt() : f === "spawnThread" ? ue(p) : f === "cleanupThread" ? Rt(() => {
          hn(Ae[p.ec]);
        }) : f === "loaded" ? (e.loaded = true, r(e)) : p.target === "setimmediate" ? e.postMessage(p) : f === "uncaughtException" ? e.onerror(p.error) : f === "callHandler" ? t[p.$b](...p.args) : f && F(`worker sent an unknown command ${f}`);
      }, e.onerror = (f) => {
        throw F(`worker sent an error! ${f.filename}:${f.lineno}: ${f.message}`), f;
      };
      var i, s = [];
      for (i of []) t.propertyIsEnumerable(i) && s.push(i);
      e.postMessage({ Rb: "load", ac: s, fc: ge, hc: b });
    });
    function yn() {
      var e = new Worker((() => {
        let r = URL;
        return void 0 > "file:" && void 0 < "file;" ? new r("ort.wasm.bundle.min.mjs", void 0) : new URL(void 0);
      })(), { type: "module", workerData: "em-pthread", name: "em-pthread" });
      ce.push(e);
    }
    var ge, gn = [], M = (e) => {
      var r = gn[e];
      return r || (gn[e] = r = lr.get(e)), r;
    }, Io = (e, r) => {
      se = 0, e = M(e)(r), 0 < se ? y = e : Ht(e);
    }, tt = [], nt = 0;
    function Bo(e) {
      var r = new xt(e >>>= 0);
      return (w(), H)[r.Sb + 12 >>> 0] == 0 && (En(r, true), nt--), Tn(r, false), tt.push(r), cr(e);
    }
    var Ne = 0, Lo = () => {
      x(0, 0);
      var e = tt.pop();
      ur(e.Wb), Ne = 0;
    };
    function En(e, r) {
      r = r ? 1 : 0, (w(), H)[e.Sb + 12 >>> 0] = r;
    }
    function Tn(e, r) {
      r = r ? 1 : 0, (w(), H)[e.Sb + 13 >>> 0] = r;
    }
    class xt {
      constructor(r) {
        this.Wb = r, this.Sb = r - 24;
      }
    }
    var Ct = (e) => {
      var r = Ne;
      if (!r) return qe(0), 0;
      var i = new xt(r);
      (w(), W)[i.Sb + 16 >>> 2 >>> 0] = r;
      var s = (w(), W)[i.Sb + 4 >>> 2 >>> 0];
      if (!s) return qe(0), r;
      for (var f of e) {
        if (f === 0 || f === s) break;
        if (fr(f, s, i.Sb + 16)) return qe(f), r;
      }
      return qe(s), r;
    };
    function _o() {
      return Ct([]);
    }
    function Do(e) {
      return Ct([e >>> 0]);
    }
    function Po(e, r, i, s) {
      return Ct([e >>> 0, r >>> 0, i >>> 0, s >>> 0]);
    }
    var Uo = () => {
      var e = tt.pop();
      e || j("no exception to throw");
      var r = e.Wb;
      throw (w(), H)[e.Sb + 13 >>> 0] == 0 && (tt.push(e), Tn(e, true), En(e, false), nt++), Vt(r), Ne = r;
    };
    function xo(e, r, i) {
      var s = new xt(e >>>= 0);
      throw r >>>= 0, i >>>= 0, (w(), W)[s.Sb + 16 >>> 2 >>> 0] = 0, (w(), W)[s.Sb + 4 >>> 2 >>> 0] = r, (w(), W)[s.Sb + 8 >>> 2 >>> 0] = i, Vt(e), nt++, Ne = e;
    }
    var Co = () => nt;
    function Sn(e, r, i, s) {
      return o ? L(2, 1, e, r, i, s) : vn(e, r, i, s);
    }
    function vn(e, r, i, s) {
      if (e >>>= 0, r >>>= 0, i >>>= 0, s >>>= 0, !globalThis.SharedArrayBuffer) return 6;
      var f = [];
      return o && f.length === 0 ? Sn(e, r, i, s) : (e = { cc: i, Qb: e, Vb: s, Zb: f }, o ? (e.Rb = "spawnThread", postMessage(e, f), 0) : ue(e));
    }
    function Mo(e) {
      throw Ne ||= e >>> 0, Ne;
    }
    var An = globalThis.TextDecoder && new TextDecoder(), On = (e, r = 0, i, s) => {
      var f = r >>>= 0;
      if (i = f + i, s) s = i;
      else {
        for (; e[f] && !(f >= i); ) ++f;
        s = f;
      }
      if (16 < s - r && e.buffer && An) return An.decode(e.buffer instanceof ArrayBuffer ? e.subarray(r, s) : e.slice(r, s));
      for (f = ""; r < s; ) if (128 & (i = e[r++])) {
        var p = 63 & e[r++];
        if ((224 & i) == 192) f += String.fromCharCode((31 & i) << 6 | p);
        else {
          var E = 63 & e[r++];
          65536 > (i = (240 & i) == 224 ? (15 & i) << 12 | p << 6 | E : (7 & i) << 18 | p << 12 | E << 6 | 63 & e[r++]) ? f += String.fromCharCode(i) : (i -= 65536, f += String.fromCharCode(55296 | i >> 10, 56320 | 1023 & i));
        }
      } else f += String.fromCharCode(i);
      return f;
    }, Mt = (e, r, i) => (e >>>= 0) ? On((w(), ne), e, r, i) : "";
    function In(e, r, i) {
      return o ? L(3, 1, e, r, i) : 0;
    }
    function Bn(e, r) {
      if (o) return L(4, 1, e, r);
    }
    function Ln(e, r) {
      if (o) return L(5, 1, e, r);
    }
    function _n(e, r, i) {
      if (o) return L(6, 1, e, r, i);
    }
    function Dn(e, r, i) {
      return o ? L(7, 1, e, r, i) : 0;
    }
    function Pn(e, r) {
      if (o) return L(8, 1, e, r);
    }
    function Un(e, r, i) {
      if (o) return L(9, 1, e, r, i);
    }
    function xn(e, r, i, s) {
      if (o) return L(10, 1, e, r, i, s);
    }
    function Cn(e, r, i, s) {
      if (o) return L(11, 1, e, r, i, s);
    }
    function Mn(e, r, i, s) {
      if (o) return L(12, 1, e, r, i, s);
    }
    function Rn(e) {
      if (o) return L(13, 1, e);
    }
    function Fn(e, r) {
      if (o) return L(14, 1, e, r);
    }
    function Nn(e, r, i) {
      if (o) return L(15, 1, e, r, i);
    }
    var Ro = () => j("");
    function Fo(e) {
      zt(e >>> 0, !u, 1, !a, 131072, false), wn();
    }
    var Rt = (e) => {
      if (!P) try {
        if (e(), !(0 < se)) try {
          o ? st() && Ht(y) : ye(y);
        } catch (r) {
          r instanceof Se || r == "unwind" || l(0, r);
        }
      } catch (r) {
        r instanceof Se || r == "unwind" || l(0, r);
      }
    }, No = !Atomics.waitAsync || globalThis.navigator?.userAgent && 91 > Number((navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./) || [])[2]);
    function Ft(e) {
      e >>>= 0, No || (Atomics.waitAsync((w(), B), e >>> 2, e).value.then(rt), e += 128, Atomics.store((w(), B), e >>> 2, 1));
    }
    var rt = () => Rt(() => {
      var e = st();
      e && (Ft(e), sr());
    });
    function ko(e, r) {
      (e >>>= 0) == r >>> 0 ? setTimeout(rt) : o ? postMessage({ Ub: e, Rb: "checkMailbox" }) : (e = Ae[e]) && e.postMessage({ Rb: "checkMailbox" });
    }
    var Nt = [];
    function Wo(e, r, i, s, f) {
      for (r >>>= 0, f >>>= 0, Nt.length = 0, i = f >>> 3, s = f + s >>> 3; i < s; ) {
        var p;
        p = (w(), O)[i++ >>> 0] ? (w(), O)[i++ >>> 0] : (w(), me)[i++ >>> 0], Nt.push(p);
      }
      return (r ? dr[r] : fa[e])(...Nt);
    }
    var Go = () => {
      se = 0;
    };
    function $o(e) {
      e >>>= 0, o ? postMessage({ Rb: "cleanupThread", ec: e }) : hn(Ae[e]);
    }
    function zo(e) {
    }
    function Ho(e, r) {
      e = -9007199254740992 > e || 9007199254740992 < e ? NaN : Number(e), r >>>= 0, e = new Date(1e3 * e), (w(), B)[r >>> 2 >>> 0] = e.getUTCSeconds(), (w(), B)[r + 4 >>> 2 >>> 0] = e.getUTCMinutes(), (w(), B)[r + 8 >>> 2 >>> 0] = e.getUTCHours(), (w(), B)[r + 12 >>> 2 >>> 0] = e.getUTCDate(), (w(), B)[r + 16 >>> 2 >>> 0] = e.getUTCMonth(), (w(), B)[r + 20 >>> 2 >>> 0] = e.getUTCFullYear() - 1900, (w(), B)[r + 24 >>> 2 >>> 0] = e.getUTCDay(), e = (e.getTime() - Date.UTC(e.getUTCFullYear(), 0, 1, 0, 0, 0, 0)) / 864e5 | 0, (w(), B)[r + 28 >>> 2 >>> 0] = e;
    }
    var kn = (e) => e % 4 == 0 && (e % 100 != 0 || e % 400 == 0), Wn = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335], Gn = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    function jo(e, r) {
      e = -9007199254740992 > e || 9007199254740992 < e ? NaN : Number(e), r >>>= 0, e = new Date(1e3 * e), (w(), B)[r >>> 2 >>> 0] = e.getSeconds(), (w(), B)[r + 4 >>> 2 >>> 0] = e.getMinutes(), (w(), B)[r + 8 >>> 2 >>> 0] = e.getHours(), (w(), B)[r + 12 >>> 2 >>> 0] = e.getDate(), (w(), B)[r + 16 >>> 2 >>> 0] = e.getMonth(), (w(), B)[r + 20 >>> 2 >>> 0] = e.getFullYear() - 1900, (w(), B)[r + 24 >>> 2 >>> 0] = e.getDay();
      var i = (kn(e.getFullYear()) ? Wn : Gn)[e.getMonth()] + e.getDate() - 1 | 0;
      (w(), B)[r + 28 >>> 2 >>> 0] = i, (w(), B)[r + 36 >>> 2 >>> 0] = -60 * e.getTimezoneOffset(), i = new Date(e.getFullYear(), 6, 1).getTimezoneOffset();
      var s = new Date(e.getFullYear(), 0, 1).getTimezoneOffset();
      e = 0 | (i != s && e.getTimezoneOffset() == Math.min(s, i)), (w(), B)[r + 32 >>> 2 >>> 0] = e;
    }
    function Vo(e) {
      e >>>= 0;
      var r = new Date((w(), B)[e + 20 >>> 2 >>> 0] + 1900, (w(), B)[e + 16 >>> 2 >>> 0], (w(), B)[e + 12 >>> 2 >>> 0], (w(), B)[e + 8 >>> 2 >>> 0], (w(), B)[e + 4 >>> 2 >>> 0], (w(), B)[e >>> 2 >>> 0], 0), i = (w(), B)[e + 32 >>> 2 >>> 0], s = r.getTimezoneOffset(), f = new Date(r.getFullYear(), 6, 1).getTimezoneOffset(), p = new Date(r.getFullYear(), 0, 1).getTimezoneOffset(), E = Math.min(p, f);
      return 0 > i ? (w(), B)[e + 32 >>> 2 >>> 0] = +(f != p && E == s) : 0 < i != (E == s) && (f = Math.max(p, f), r.setTime(r.getTime() + 6e4 * ((0 < i ? E : f) - s))), (w(), B)[e + 24 >>> 2 >>> 0] = r.getDay(), i = (kn(r.getFullYear()) ? Wn : Gn)[r.getMonth()] + r.getDate() - 1 | 0, (w(), B)[e + 28 >>> 2 >>> 0] = i, (w(), B)[e >>> 2 >>> 0] = r.getSeconds(), (w(), B)[e + 4 >>> 2 >>> 0] = r.getMinutes(), (w(), B)[e + 8 >>> 2 >>> 0] = r.getHours(), (w(), B)[e + 12 >>> 2 >>> 0] = r.getDate(), (w(), B)[e + 16 >>> 2 >>> 0] = r.getMonth(), (w(), B)[e + 20 >>> 2 >>> 0] = r.getYear(), e = r.getTime(), BigInt(isNaN(e) ? -1 : e / 1e3);
    }
    function $n(e, r, i, s, f, p, E) {
      return o ? L(16, 1, e, r, i, s, f, p, E) : -52;
    }
    function zn(e, r, i, s, f, p) {
      if (o) return L(17, 1, e, r, i, s, f, p);
    }
    var Ye = {}, Yo = () => performance.timeOrigin + performance.now();
    function Hn(e, r) {
      if (o) return L(18, 1, e, r);
      if (Ye[e] && (clearTimeout(Ye[e].id), delete Ye[e]), !r) return 0;
      var i = setTimeout(() => {
        delete Ye[e], Rt(() => ar(e, performance.timeOrigin + performance.now()));
      }, r);
      return Ye[e] = { id: i, oc: r }, 0;
    }
    var Oe = (e, r, i) => {
      var s = (w(), ne);
      if (r >>>= 0, 0 < i) {
        var f = r;
        i = r + i - 1;
        for (var p = 0; p < e.length; ++p) {
          var E = e.codePointAt(p);
          if (127 >= E) {
            if (r >= i) break;
            s[r++ >>> 0] = E;
          } else if (2047 >= E) {
            if (r + 1 >= i) break;
            s[r++ >>> 0] = 192 | E >> 6, s[r++ >>> 0] = 128 | 63 & E;
          } else if (65535 >= E) {
            if (r + 2 >= i) break;
            s[r++ >>> 0] = 224 | E >> 12, s[r++ >>> 0] = 128 | E >> 6 & 63, s[r++ >>> 0] = 128 | 63 & E;
          } else {
            if (r + 3 >= i) break;
            s[r++ >>> 0] = 240 | E >> 18, s[r++ >>> 0] = 128 | E >> 12 & 63, s[r++ >>> 0] = 128 | E >> 6 & 63, s[r++ >>> 0] = 128 | 63 & E, p++;
          }
        }
        s[r >>> 0] = 0, e = r - f;
      } else e = 0;
      return e;
    };
    function qo(e, r, i, s) {
      e >>>= 0, r >>>= 0, i >>>= 0, s >>>= 0;
      var f = (/* @__PURE__ */ new Date()).getFullYear(), p = new Date(f, 0, 1).getTimezoneOffset();
      f = new Date(f, 6, 1).getTimezoneOffset();
      var E = Math.max(p, f);
      (w(), W)[e >>> 2 >>> 0] = 60 * E, (w(), B)[r >>> 2 >>> 0] = +(p != f), e = (r = (S) => {
        var C = Math.abs(S);
        return `UTC${0 <= S ? "-" : "+"}${String(Math.floor(C / 60)).padStart(2, "0")}${String(C % 60).padStart(2, "0")}`;
      })(p), r = r(f), f < p ? (Oe(e, i, 17), Oe(r, s, 17)) : (Oe(e, s, 17), Oe(r, i, 17));
    }
    var Jo = () => Date.now(), Xo = 1;
    function Zo(e, r, i) {
      if (i >>>= 0, !(0 <= e && 3 >= e)) return 28;
      if (e === 0) e = Date.now();
      else {
        if (!Xo) return 52;
        e = performance.timeOrigin + performance.now();
      }
      return e = Math.round(1e6 * e), (w(), O)[i >>> 3 >>> 0] = BigInt(e), 0;
    }
    var kt = [];
    function Qo(e, r, i) {
      e >>>= 0, r >>>= 0, i >>>= 0, kt.length = 0;
      for (var s; s = (w(), ne)[r++ >>> 0]; ) {
        var f = s != 105;
        i += (f &= s != 112) && i % 8 ? 4 : 0, kt.push(s == 112 ? (w(), W)[i >>> 2 >>> 0] : s == 106 ? (w(), O)[i >>> 3 >>> 0] : s == 105 ? (w(), B)[i >>> 2 >>> 0] : (w(), me)[i >>> 3 >>> 0]), i += f ? 8 : 4;
      }
      return dr[e](...kt);
    }
    var Ko = () => {
    };
    function ea(e, r) {
      return F(Mt(e >>> 0, r >>> 0));
    }
    var ta = () => {
      throw se += 1, "unwind";
    };
    function na() {
      return 4294901760;
    }
    var ra = () => navigator.hardwareConcurrency, Ie = {}, Wt = (e) => {
      for (var r = 0, i = 0; i < e.length; ++i) {
        var s = e.charCodeAt(i);
        127 >= s ? r++ : 2047 >= s ? r += 2 : 55296 <= s && 57343 >= s ? (r += 4, ++i) : r += 3;
      }
      return r;
    }, ot = (e) => {
      var r;
      return (r = /\bwasm-function\[\d+\]:(0x[0-9a-f]+)/.exec(e)) ? +r[1] : (r = /:(\d+):\d+(?:\)|$)/.exec(e)) ? 2147483648 | +r[1] : 0;
    }, jn = (e) => {
      for (var r of e) (e = ot(r)) && (Ie[e] = r);
    };
    function oa() {
      var e = Error().stack.toString().split(`
`);
      return e[0] == "Error" && e.shift(), jn(e), Ie.Xb = ot(e[3]), Ie.bc = e, Ie.Xb;
    }
    function at(e) {
      if (!(e = Ie[e >>> 0])) return 0;
      var r;
      if (r = /^\s+at .*\.wasm\.(.*) \(.*\)$/.exec(e)) e = r[1];
      else if (r = /^\s+at (.*) \(.*\)$/.exec(e)) e = r[1];
      else {
        if (!(r = /^(.+?)@/.exec(e))) return 0;
        e = r[1];
      }
      er(at.Yb ?? 0), r = Wt(e) + 1;
      var i = tr(r);
      return i && Oe(e, i, r), at.Yb = i, at.Yb;
    }
    function aa(e) {
      e >>>= 0;
      var r = (w(), ne).length;
      if (e <= r || 4294901760 < e) return false;
      for (var i = 1; 4 >= i; i *= 2) {
        var s = r * (1 + 0.2 / i);
        s = Math.min(s, e + 100663296);
        e: {
          s = (Math.min(4294901760, 65536 * Math.ceil(Math.max(e, s) / 65536)) - ge.buffer.byteLength + 65535) / 65536 | 0;
          try {
            ge.grow(s), ee();
            var f = 1;
            break e;
          } catch {
          }
          f = void 0;
        }
        if (f) return true;
      }
      return false;
    }
    function sa(e, r, i) {
      if (e >>>= 0, r >>>= 0, Ie.Xb == e) var s = Ie.bc;
      else (s = Error().stack.toString().split(`
`))[0] == "Error" && s.shift(), jn(s);
      for (var f = 3; s[f] && ot(s[f]) != e; ) ++f;
      for (e = 0; e < i && s[e + f]; ++e) (w(), B)[r + 4 * e >>> 2 >>> 0] = ot(s[e + f]);
      return e;
    }
    var Gt, $t = {}, Vn = () => {
      if (!Gt) {
        var e, r = { USER: "web_user", LOGNAME: "web_user", PATH: "/", PWD: "/", HOME: "/home/web_user", LANG: (globalThis.navigator?.language ?? "C").replace("-", "_") + ".UTF-8", _: "./this.program" };
        for (e in $t) $t[e] === void 0 ? delete r[e] : r[e] = $t[e];
        var i = [];
        for (e in r) i.push(`${e}=${r[e]}`);
        Gt = i;
      }
      return Gt;
    };
    function Yn(e, r) {
      if (o) return L(19, 1, e, r);
      e >>>= 0, r >>>= 0;
      var i, s = 0, f = 0;
      for (i of Vn()) {
        var p = r + s;
        (w(), W)[e + f >>> 2 >>> 0] = p, s += Oe(i, p, 1 / 0) + 1, f += 4;
      }
      return 0;
    }
    function qn(e, r) {
      if (o) return L(20, 1, e, r);
      e >>>= 0, r >>>= 0;
      var i = Vn();
      for (var s of ((w(), W)[e >>> 2 >>> 0] = i.length, e = 0, i)) e += Wt(s) + 1;
      return (w(), W)[r >>> 2 >>> 0] = e, 0;
    }
    function Jn(e) {
      return o ? L(21, 1, e) : 52;
    }
    function Xn(e, r, i, s, f) {
      return o ? L(22, 1, e, r, i, s, f) : 52;
    }
    function Zn(e, r, i, s) {
      return o ? L(23, 1, e, r, i, s) : 52;
    }
    function Qn(e, r, i, s) {
      return o ? L(24, 1, e, r, i, s) : 70;
    }
    var ia = [null, [], []];
    function Kn(e, r, i, s) {
      if (o) return L(25, 1, e, r, i, s);
      r >>>= 0, i >>>= 0, s >>>= 0;
      for (var f = 0, p = 0; p < i; p++) {
        var E = (w(), W)[r >>> 2 >>> 0], S = (w(), W)[r + 4 >>> 2 >>> 0];
        r += 8;
        for (var C = 0; C < S; C++) {
          var R = e, X = (w(), ne)[E + C >>> 0], le = ia[R];
          X === 0 || X === 10 ? ((R === 1 ? A : F)(On(le)), le.length = 0) : le.push(X);
        }
        f += S;
      }
      return (w(), W)[s >>> 2 >>> 0] = f, 0;
    }
    function ua(e) {
      return e >>> 0;
    }
    o || (function() {
      for (var e = t.numThreads - 1; e--; ) yn();
      Ve.push(async () => {
        var r = (async function() {
          if (!o) return Promise.all(ce.map(bn));
        })();
        Re++, await r, --Re == 0 && te && (r = te, te = null, r());
      });
    })(), o || (ge = new WebAssembly.Memory({ initial: 256, maximum: 65536, shared: true }), ee()), t.wasmBinary && (g = t.wasmBinary), t.stackSave = () => U(), t.stackRestore = (e) => _(e), t.stackAlloc = (e) => jt(e), t.setValue = function(e, r, i = "i8") {
      switch (i.endsWith("*") && (i = "*"), i) {
        case "i1":
        case "i8":
          (w(), H)[e >>> 0] = r;
          break;
        case "i16":
          (w(), pe)[e >>> 1 >>> 0] = r;
          break;
        case "i32":
          (w(), B)[e >>> 2 >>> 0] = r;
          break;
        case "i64":
          (w(), O)[e >>> 3 >>> 0] = BigInt(r);
          break;
        case "float":
          (w(), re)[e >>> 2 >>> 0] = r;
          break;
        case "double":
          (w(), me)[e >>> 3 >>> 0] = r;
          break;
        case "*":
          (w(), W)[e >>> 2 >>> 0] = r;
          break;
        default:
          j(`invalid type for setValue: ${i}`);
      }
    }, t.getValue = function(e, r = "i8") {
      switch (r.endsWith("*") && (r = "*"), r) {
        case "i1":
        case "i8":
          return (w(), H)[e >>> 0];
        case "i16":
          return (w(), pe)[e >>> 1 >>> 0];
        case "i32":
          return (w(), B)[e >>> 2 >>> 0];
        case "i64":
          return (w(), O)[e >>> 3 >>> 0];
        case "float":
          return (w(), re)[e >>> 2 >>> 0];
        case "double":
          return (w(), me)[e >>> 3 >>> 0];
        case "*":
          return (w(), W)[e >>> 2 >>> 0];
        default:
          j(`invalid type for getValue: ${r}`);
      }
    }, t.UTF8ToString = Mt, t.stringToUTF8 = Oe, t.lengthBytesUTF8 = Wt;
    var st, er, tr, zt, nr, rr, or, Ht, ar, sr, x, qe, ir, _, jt, U, ur, Vt, fr, cr, lr, Ee, fa = [V, fe, Sn, In, Bn, Ln, _n, Dn, Pn, Un, xn, Cn, Mn, Rn, Fn, Nn, $n, zn, Hn, Yn, qn, Jn, Xn, Zn, Qn, Kn], dr = { 1042604: (e, r, i, s, f) => {
      if (t === void 0 || !t.Tb) return 1;
      if ((e = Mt(Number(e >>> 0))).startsWith("./") && (e = e.substring(2)), !(e = t.Tb.get(e))) return 2;
      if (r = Number(r >>> 0), i = Number(i >>> 0), s = Number(s >>> 0), r + i > e.byteLength) return 3;
      try {
        let p = e.subarray(r, r + i);
        switch (f) {
          case 0:
            (w(), ne).set(p, s >>> 0);
            break;
          case 1:
            t.ic ? t.ic(s, p) : t.kc(s, p);
            break;
          default:
            return 4;
        }
        return 0;
      } catch {
        return 4;
      }
    }, 1043428: () => typeof wasmOffsetConverter < "u" };
    function ca() {
      return typeof wasmOffsetConverter < "u";
    }
    function la(e, r, i, s) {
      var f = U();
      try {
        return M(e)(r, i, s);
      } catch (p) {
        if (_(f), p !== p + 0) throw p;
        x(1, 0);
      }
    }
    function da(e, r, i) {
      var s = U();
      try {
        return M(e)(r, i);
      } catch (f) {
        if (_(s), f !== f + 0) throw f;
        x(1, 0);
      }
    }
    function pa(e) {
      var r = U();
      try {
        M(e)();
      } catch (i) {
        if (_(r), i !== i + 0) throw i;
        x(1, 0);
      }
    }
    function ma(e, r) {
      var i = U();
      try {
        return M(e)(r);
      } catch (s) {
        if (_(i), s !== s + 0) throw s;
        x(1, 0);
      }
    }
    function ha(e, r, i) {
      var s = U();
      try {
        M(e)(r, i);
      } catch (f) {
        if (_(s), f !== f + 0) throw f;
        x(1, 0);
      }
    }
    function wa(e, r) {
      var i = U();
      try {
        M(e)(r);
      } catch (s) {
        if (_(i), s !== s + 0) throw s;
        x(1, 0);
      }
    }
    function ba(e, r, i, s, f, p, E) {
      var S = U();
      try {
        return M(e)(r, i, s, f, p, E);
      } catch (C) {
        if (_(S), C !== C + 0) throw C;
        x(1, 0);
      }
    }
    function ya(e, r, i, s, f, p) {
      var E = U();
      try {
        M(e)(r, i, s, f, p);
      } catch (S) {
        if (_(E), S !== S + 0) throw S;
        x(1, 0);
      }
    }
    function ga(e, r, i, s) {
      var f = U();
      try {
        M(e)(r, i, s);
      } catch (p) {
        if (_(f), p !== p + 0) throw p;
        x(1, 0);
      }
    }
    function Ea(e, r, i, s, f) {
      var p = U();
      try {
        M(e)(r, i, s, f);
      } catch (E) {
        if (_(p), E !== E + 0) throw E;
        x(1, 0);
      }
    }
    function Ta(e, r, i, s, f, p, E) {
      var S = U();
      try {
        M(e)(r, i, s, f, p, E);
      } catch (C) {
        if (_(S), C !== C + 0) throw C;
        x(1, 0);
      }
    }
    function Sa(e, r, i, s, f, p, E) {
      var S = U();
      try {
        M(e)(r, i, s, f, p, E);
      } catch (C) {
        if (_(S), C !== C + 0) throw C;
        x(1, 0);
      }
    }
    function va(e, r, i, s, f, p, E, S) {
      var C = U();
      try {
        M(e)(r, i, s, f, p, E, S);
      } catch (R) {
        if (_(C), R !== R + 0) throw R;
        x(1, 0);
      }
    }
    function Aa(e, r, i, s, f) {
      var p = U();
      try {
        return M(e)(r, i, s, f);
      } catch (E) {
        if (_(p), E !== E + 0) throw E;
        x(1, 0);
      }
    }
    function Oa(e, r, i) {
      var s = U();
      try {
        return M(e)(r, i);
      } catch (f) {
        if (_(s), f !== f + 0) throw f;
        x(1, 0);
      }
    }
    function Ia(e, r, i, s, f, p, E, S) {
      var C = U();
      try {
        M(e)(r, i, s, f, p, E, S);
      } catch (R) {
        if (_(C), R !== R + 0) throw R;
        x(1, 0);
      }
    }
    function Ba(e, r, i, s, f, p, E, S, C, R, X, le) {
      var we = U();
      try {
        M(e)(r, i, s, f, p, E, S, C, R, X, le);
      } catch (be) {
        if (_(we), be !== be + 0) throw be;
        x(1, 0);
      }
    }
    function La(e, r, i) {
      var s = U();
      try {
        return M(e)(r, i);
      } catch (f) {
        if (_(s), f !== f + 0) throw f;
        return x(1, 0), 0n;
      }
    }
    function _a(e, r, i, s, f, p, E, S, C) {
      var R = U();
      try {
        M(e)(r, i, s, f, p, E, S, C);
      } catch (X) {
        if (_(R), X !== X + 0) throw X;
        x(1, 0);
      }
    }
    function Da(e) {
      var r = U();
      try {
        return M(e)();
      } catch (i) {
        if (_(r), i !== i + 0) throw i;
        x(1, 0);
      }
    }
    function Pa(e, r) {
      var i = U();
      try {
        return M(e)(r);
      } catch (s) {
        if (_(i), s !== s + 0) throw s;
        return x(1, 0), 0n;
      }
    }
    function Ua(e, r, i, s) {
      var f = U();
      try {
        return M(e)(r, i, s);
      } catch (p) {
        if (_(f), p !== p + 0) throw p;
        x(1, 0);
      }
    }
    function xa(e) {
      var r = U();
      try {
        return M(e)();
      } catch (i) {
        if (_(r), i !== i + 0) throw i;
        return x(1, 0), 0n;
      }
    }
    function Ca(e, r, i, s) {
      var f = U();
      try {
        return M(e)(r, i, s);
      } catch (p) {
        if (_(f), p !== p + 0) throw p;
        x(1, 0);
      }
    }
    function Ma(e, r, i, s, f) {
      var p = U();
      try {
        return M(e)(r, i, s, f);
      } catch (E) {
        if (_(p), E !== E + 0) throw E;
        x(1, 0);
      }
    }
    function Ra(e, r, i, s, f, p) {
      var E = U();
      try {
        return M(e)(r, i, s, f, p);
      } catch (S) {
        if (_(E), S !== S + 0) throw S;
        x(1, 0);
      }
    }
    function Fa(e, r, i, s, f, p) {
      var E = U();
      try {
        return M(e)(r, i, s, f, p);
      } catch (S) {
        if (_(E), S !== S + 0) throw S;
        x(1, 0);
      }
    }
    function Na(e, r, i, s, f, p) {
      var E = U();
      try {
        return M(e)(r, i, s, f, p);
      } catch (S) {
        if (_(E), S !== S + 0) throw S;
        x(1, 0);
      }
    }
    function ka(e, r, i, s, f, p, E, S) {
      var C = U();
      try {
        return M(e)(r, i, s, f, p, E, S);
      } catch (R) {
        if (_(C), R !== R + 0) throw R;
        x(1, 0);
      }
    }
    function Wa(e, r, i, s, f) {
      var p = U();
      try {
        return M(e)(r, i, s, f);
      } catch (E) {
        if (_(p), E !== E + 0) throw E;
        return x(1, 0), 0n;
      }
    }
    function Ga(e, r, i, s) {
      var f = U();
      try {
        return M(e)(r, i, s);
      } catch (p) {
        if (_(f), p !== p + 0) throw p;
        x(1, 0);
      }
    }
    function $a(e, r, i, s) {
      var f = U();
      try {
        return M(e)(r, i, s);
      } catch (p) {
        if (_(f), p !== p + 0) throw p;
        x(1, 0);
      }
    }
    function za(e, r, i, s, f, p, E, S, C, R, X, le) {
      var we = U();
      try {
        return M(e)(r, i, s, f, p, E, S, C, R, X, le);
      } catch (be) {
        if (_(we), be !== be + 0) throw be;
        x(1, 0);
      }
    }
    function Ha(e, r, i, s, f, p, E, S, C, R, X) {
      var le = U();
      try {
        M(e)(r, i, s, f, p, E, S, C, R, X);
      } catch (we) {
        if (_(le), we !== we + 0) throw we;
        x(1, 0);
      }
    }
    function ja(e, r, i, s, f, p, E, S, C, R, X, le, we, be, Ja, Xa) {
      var Za = U();
      try {
        M(e)(r, i, s, f, p, E, S, C, R, X, le, we, be, Ja, Xa);
      } catch (Yt) {
        if (_(Za), Yt !== Yt + 0) throw Yt;
        x(1, 0);
      }
    }
    function Va(e, r, i) {
      var s = U();
      try {
        return M(e)(r, i);
      } catch (f) {
        if (_(s), f !== f + 0) throw f;
        x(1, 0);
      }
    }
    function Ya(e, r, i) {
      var s = U();
      try {
        return M(e)(r, i);
      } catch (f) {
        if (_(s), f !== f + 0) throw f;
        x(1, 0);
      }
    }
    function qa(e, r, i, s) {
      var f = U();
      try {
        M(e)(r, i, s);
      } catch (p) {
        if (_(f), p !== p + 0) throw p;
        x(1, 0);
      }
    }
    function it() {
      if (0 < Re) te = it;
      else if (o) T?.(t), he();
      else {
        for (var e = Ve; 0 < e.length; ) e.shift()(t);
        0 < Re ? te = it : (t.calledRun = true, P || (he(), T?.(t)));
      }
    }
    return o || (Ee = await Ut(), it()), t.PTR_SIZE = 4, je ? t : new Promise((e, r) => {
      T = e, I = r;
    });
  }
  var as;
  var ss;
  var Jr = N(() => {
    "use strict";
    as = Yr, ss = globalThis.self?.name?.startsWith("em-pthread");
    ss && Yr();
  });
  var Qr;
  var an;
  var is;
  var oe;
  var Kr;
  var on;
  var us;
  var fs;
  var eo;
  var cs;
  var Xr;
  var to;
  var Zr;
  var no;
  var pt = N(() => {
    "use strict";
    dt();
    Qr = typeof location > "u" ? void 0 : location.origin, an = void 0 > "file:" && void 0 < "file;", is = () => {
      if (true) {
        if (an) {
          let n = URL;
          return new URL(new n("ort.wasm.bundle.min.mjs", void 0).href, Qr).href;
        }
        return void 0;
      }
    }, oe = is(), Kr = () => {
      if (oe && !oe.startsWith("blob:")) return oe.substring(0, oe.lastIndexOf("/") + 1);
    }, on = (n, t) => {
      try {
        let a = t ?? oe;
        return (a ? new URL(n, a) : new URL(n)).origin === Qr;
      } catch {
        return false;
      }
    }, us = (n, t) => {
      let a = t ?? oe;
      try {
        return (a ? new URL(n, a) : new URL(n)).href;
      } catch {
        return;
      }
    }, fs = (n, t) => `${t ?? "./"}${n}`, eo = async (n) => {
      let a = await (await fetch(n, { credentials: "same-origin" })).blob();
      return URL.createObjectURL(a);
    }, cs = async (n) => (await import(
      /*webpackIgnore:true*/
      /*@vite-ignore*/
      n
    )).default, Xr = (Vr(), Xt(jr)).default, to = async () => {
      if (!oe) throw new Error("Failed to load proxy worker: cannot determine the script source URL.");
      if (on(oe)) return [void 0, Xr()];
      let n = await eo(oe);
      return [n, Xr(n)];
    }, Zr = (Jr(), Xt(qr)).default, no = async (n, t, a, u) => {
      let o = Zr && !(n || t);
      if (o) if (oe) o = on(oe) || u && !a;
      else if (u && !a) o = true;
      else throw new Error("cannot determine the script source URL.");
      if (o) return [void 0, Zr];
      {
        let d = "ort-wasm-simd-threaded.mjs", c = n ?? us(d, t), l = a && c && !on(c, t), m = l ? await eo(c) : c ?? fs(d, t);
        return [l ? m : void 0, await cs(m)];
      }
    };
  });
  var sn;
  var un;
  var St;
  var ro;
  var ls;
  var ds;
  var ps;
  var mt;
  var z;
  var xe = N(() => {
    "use strict";
    pt();
    un = false, St = false, ro = false, ls = () => {
      if (typeof SharedArrayBuffer > "u") return false;
      try {
        return typeof MessageChannel < "u" && new MessageChannel().port1.postMessage(new SharedArrayBuffer(1)), WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 4, 1, 3, 1, 1, 10, 11, 1, 9, 0, 65, 0, 254, 16, 2, 0, 26, 11]));
      } catch {
        return false;
      }
    }, ds = () => {
      try {
        return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 30, 1, 28, 0, 65, 0, 253, 15, 253, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 253, 186, 1, 26, 11]));
      } catch {
        return false;
      }
    }, ps = () => {
      try {
        return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 19, 1, 17, 0, 65, 1, 253, 15, 65, 2, 253, 15, 65, 3, 253, 15, 253, 147, 2, 11]));
      } catch {
        return false;
      }
    }, mt = async (n) => {
      if (un) return Promise.resolve();
      if (St) throw new Error("multiple calls to 'initializeWebAssembly()' detected.");
      if (ro) throw new Error("previous call to 'initializeWebAssembly()' failed.");
      St = true;
      let t = n.initTimeout, a = n.numThreads;
      if (n.simd !== false) {
        if (n.simd === "relaxed") {
          if (!ps()) throw new Error("Relaxed WebAssembly SIMD is not supported in the current environment.");
        } else if (!ds()) throw new Error("WebAssembly SIMD is not supported in the current environment.");
      }
      let u = ls();
      a > 1 && !u && (typeof self < "u" && !self.crossOriginIsolated && console.warn("env.wasm.numThreads is set to " + a + ", but this will not work unless you enable crossOriginIsolated mode. See https://web.dev/cross-origin-isolation-guide/ for more info."), console.warn("WebAssembly multi-threading is not supported in the current environment. Falling back to single-threading."), n.numThreads = a = 1);
      let o = n.wasmPaths, d = typeof o == "string" ? o : void 0, c = o?.mjs, l = c?.href ?? c, m = o?.wasm, h = m?.href ?? m, g = n.wasmBinary, [b, y] = await no(l, d, a > 1, !!g || !!h), T = false, I = [];
      if (t > 0 && I.push(new Promise((D) => {
        setTimeout(() => {
          T = true, D();
        }, t);
      })), I.push(new Promise((D, $) => {
        let v = { numThreads: a };
        if (g) v.wasmBinary = g, v.locateFile = (A) => A;
        else if (h || d) v.locateFile = (A) => h ?? d + A;
        else if (l && l.indexOf("blob:") !== 0) v.locateFile = (A) => new URL(A, l).href;
        else if (b) {
          let A = Kr();
          A && (v.locateFile = (F) => A + F);
        }
        y(v).then((A) => {
          St = false, un = true, sn = A, D(), b && URL.revokeObjectURL(b);
        }, (A) => {
          St = false, ro = true, $(A);
        });
      })), await Promise.race(I), T) throw new Error(`WebAssembly backend initializing failed due to timeout: ${t}ms`);
    }, z = () => {
      if (un && sn) return sn;
      throw new Error("WebAssembly is not initialized yet.");
    };
  });
  var ae;
  var Qe;
  var G;
  var vt = N(() => {
    "use strict";
    xe();
    ae = (n, t) => {
      let a = z(), u = a.lengthBytesUTF8(n) + 1, o = a._malloc(u);
      return a.stringToUTF8(n, o, u), t.push(o), o;
    }, Qe = (n, t, a, u) => {
      if (typeof n == "object" && n !== null) {
        if (a.has(n)) throw new Error("Circular reference in options");
        a.add(n);
      }
      Object.entries(n).forEach(([o, d]) => {
        let c = t ? t + o : o;
        if (typeof d == "object") Qe(d, c + ".", a, u);
        else if (typeof d == "string" || typeof d == "number") u(c, d.toString());
        else if (typeof d == "boolean") u(c, d ? "1" : "0");
        else throw new Error(`Can't handle extra config type: ${typeof d}`);
      });
    }, G = (n) => {
      let t = z(), a = t.stackSave();
      try {
        let u = t.PTR_SIZE, o = t.stackAlloc(2 * u);
        t._OrtGetLastError(o, o + u);
        let d = Number(t.getValue(o, u === 4 ? "i32" : "i64")), c = t.getValue(o + u, "*"), l = c ? t.UTF8ToString(c) : "";
        throw new Error(`${n} ERROR_CODE: ${d}, ERROR_MESSAGE: ${l}`);
      } finally {
        t.stackRestore(a);
      }
    };
  });
  var oo;
  var ao = N(() => {
    "use strict";
    xe();
    vt();
    oo = (n) => {
      let t = z(), a = 0, u = [], o = n || {};
      try {
        if (n?.logSeverityLevel === void 0) o.logSeverityLevel = 2;
        else if (typeof n.logSeverityLevel != "number" || !Number.isInteger(n.logSeverityLevel) || n.logSeverityLevel < 0 || n.logSeverityLevel > 4) throw new Error(`log severity level is not valid: ${n.logSeverityLevel}`);
        if (n?.logVerbosityLevel === void 0) o.logVerbosityLevel = 0;
        else if (typeof n.logVerbosityLevel != "number" || !Number.isInteger(n.logVerbosityLevel)) throw new Error(`log verbosity level is not valid: ${n.logVerbosityLevel}`);
        n?.terminate === void 0 && (o.terminate = false);
        let d = 0;
        return n?.tag !== void 0 && (d = ae(n.tag, u)), a = t._OrtCreateRunOptions(o.logSeverityLevel, o.logVerbosityLevel, !!o.terminate, d), a === 0 && G("Can't create run options."), n?.extra !== void 0 && Qe(n.extra, "", /* @__PURE__ */ new WeakSet(), (c, l) => {
          let m = ae(c, u), h = ae(l, u);
          t._OrtAddRunConfigEntry(a, m, h) !== 0 && G(`Can't set a run config entry: ${c} - ${l}.`);
        }), [a, u];
      } catch (d) {
        throw a !== 0 && t._OrtReleaseRunOptions(a), u.forEach((c) => t._free(c)), d;
      }
    };
  });
  var ms;
  var hs;
  var ws;
  var ke;
  var bs;
  var so;
  var io = N(() => {
    "use strict";
    xe();
    vt();
    ms = (n) => {
      switch (n) {
        case "disabled":
          return 0;
        case "basic":
          return 1;
        case "extended":
          return 2;
        case "layout":
          return 3;
        case "all":
          return 99;
        default:
          throw new Error(`unsupported graph optimization level: ${n}`);
      }
    }, hs = (n) => {
      switch (n) {
        case "sequential":
          return 0;
        case "parallel":
          return 1;
        default:
          throw new Error(`unsupported execution mode: ${n}`);
      }
    }, ws = (n) => {
      n.extra || (n.extra = {}), n.extra.session || (n.extra.session = {});
      let t = n.extra.session;
      t.use_ort_model_bytes_directly || (t.use_ort_model_bytes_directly = "1"), n.executionProviders && n.executionProviders.some((a) => (typeof a == "string" ? a : a.name) === "webgpu") && (n.enableMemPattern = false);
    }, ke = (n, t, a, u) => {
      let o = ae(t, u), d = ae(a, u);
      z()._OrtAddSessionConfigEntry(n, o, d) !== 0 && G(`Can't set a session config entry: ${t} - ${a}.`);
    }, bs = async (n, t, a) => {
      let u = t.executionProviders;
      for (let o of u) {
        let d = typeof o == "string" ? o : o.name, c = [];
        switch (d) {
          case "webnn":
            if (d = "WEBNN", ke(n, "session.disable_quant_qdq", "1", a), ke(n, "session.disable_qdq_constant_folding", "1", a), typeof o != "string") {
              let y = o?.deviceType;
              y && ke(n, "deviceType", y, a);
            }
            break;
          case "webgpu":
            if (d = "JS", typeof o != "string") {
              let b = o;
              if (b?.preferredLayout) {
                if (b.preferredLayout !== "NCHW" && b.preferredLayout !== "NHWC") throw new Error(`preferredLayout must be either 'NCHW' or 'NHWC': ${b.preferredLayout}`);
                ke(n, "preferredLayout", b.preferredLayout, a);
              }
            }
            break;
          case "wasm":
          case "cpu":
            continue;
          default:
            throw new Error(`not supported execution provider: ${d}`);
        }
        let l = ae(d, a), m = c.length, h = 0, g = 0;
        if (m > 0) {
          h = z()._malloc(m * z().PTR_SIZE), a.push(h), g = z()._malloc(m * z().PTR_SIZE), a.push(g);
          for (let b = 0; b < m; b++) z().setValue(h + b * z().PTR_SIZE, c[b][0], "*"), z().setValue(g + b * z().PTR_SIZE, c[b][1], "*");
        }
        await z()._OrtAppendExecutionProvider(n, l, h, g, m) !== 0 && G(`Can't append execution provider: ${d}.`);
      }
    }, so = async (n) => {
      let t = z(), a = 0, u = [], o = n || {};
      ws(o);
      try {
        let d = ms(o.graphOptimizationLevel ?? "all"), c = hs(o.executionMode ?? "sequential"), l = typeof o.logId == "string" ? ae(o.logId, u) : 0, m = o.logSeverityLevel ?? 2;
        if (!Number.isInteger(m) || m < 0 || m > 4) throw new Error(`log severity level is not valid: ${m}`);
        let h = o.logVerbosityLevel ?? 0;
        if (!Number.isInteger(h) || h < 0 || h > 4) throw new Error(`log verbosity level is not valid: ${h}`);
        let g = typeof o.optimizedModelFilePath == "string" ? ae(o.optimizedModelFilePath, u) : 0;
        if (a = t._OrtCreateSessionOptions(d, !!o.enableCpuMemArena, !!o.enableMemPattern, c, !!o.enableProfiling, 0, l, m, h, g), a === 0 && G("Can't create session options."), o.executionProviders && await bs(a, o, u), o.enableGraphCapture !== void 0) {
          if (typeof o.enableGraphCapture != "boolean") throw new Error(`enableGraphCapture must be a boolean value: ${o.enableGraphCapture}`);
          ke(a, "enableGraphCapture", o.enableGraphCapture.toString(), u);
        }
        if (o.freeDimensionOverrides) for (let [b, y] of Object.entries(o.freeDimensionOverrides)) {
          if (typeof b != "string") throw new Error(`free dimension override name must be a string: ${b}`);
          if (typeof y != "number" || !Number.isInteger(y) || y < 0) throw new Error(`free dimension override value must be a non-negative integer: ${y}`);
          let T = ae(b, u);
          t._OrtAddFreeDimensionOverride(a, T, y) !== 0 && G(`Can't set a free dimension override: ${b} - ${y}.`);
        }
        return o.extra !== void 0 && Qe(o.extra, "", /* @__PURE__ */ new WeakSet(), (b, y) => {
          ke(a, b, y, u);
        }), [a, u];
      } catch (d) {
        throw a !== 0 && t._OrtReleaseSessionOptions(a) !== 0 && G("Can't release session options."), u.forEach((c) => t._free(c)), d;
      }
    };
  });
  var We;
  var At;
  var Ge;
  var uo;
  var fo;
  var Ot;
  var It;
  var co;
  var fn = N(() => {
    "use strict";
    We = (n) => {
      switch (n) {
        case "int8":
          return 3;
        case "uint8":
          return 2;
        case "bool":
          return 9;
        case "int16":
          return 5;
        case "uint16":
          return 4;
        case "int32":
          return 6;
        case "uint32":
          return 12;
        case "float16":
          return 10;
        case "float32":
          return 1;
        case "float64":
          return 11;
        case "string":
          return 8;
        case "int64":
          return 7;
        case "uint64":
          return 13;
        case "int4":
          return 22;
        case "uint4":
          return 21;
        default:
          throw new Error(`unsupported data type: ${n}`);
      }
    }, At = (n) => {
      switch (n) {
        case 3:
          return "int8";
        case 2:
          return "uint8";
        case 9:
          return "bool";
        case 5:
          return "int16";
        case 4:
          return "uint16";
        case 6:
          return "int32";
        case 12:
          return "uint32";
        case 10:
          return "float16";
        case 1:
          return "float32";
        case 11:
          return "float64";
        case 8:
          return "string";
        case 7:
          return "int64";
        case 13:
          return "uint64";
        case 22:
          return "int4";
        case 21:
          return "uint4";
        default:
          throw new Error(`unsupported data type: ${n}`);
      }
    }, Ge = (n, t) => {
      let a = [-1, 4, 1, 1, 2, 2, 4, 8, -1, 1, 2, 8, 4, 8, -1, -1, -1, -1, -1, -1, -1, 0.5, 0.5][n], u = typeof t == "number" ? t : t.reduce((o, d) => o * d, 1);
      return a > 0 ? Math.ceil(u * a) : void 0;
    }, uo = (n) => {
      switch (n) {
        case "float16":
          return typeof Float16Array < "u" ? Float16Array : Uint16Array;
        case "float32":
          return Float32Array;
        case "uint8":
          return Uint8Array;
        case "int8":
          return Int8Array;
        case "uint16":
          return Uint16Array;
        case "int16":
          return Int16Array;
        case "int32":
          return Int32Array;
        case "bool":
          return Uint8Array;
        case "float64":
          return Float64Array;
        case "uint32":
          return Uint32Array;
        case "int64":
          return BigInt64Array;
        case "uint64":
          return BigUint64Array;
        default:
          throw new Error(`unsupported type: ${n}`);
      }
    }, fo = (n) => {
      switch (n) {
        case "verbose":
          return 0;
        case "info":
          return 1;
        case "warning":
          return 2;
        case "error":
          return 3;
        case "fatal":
          return 4;
        default:
          throw new Error(`unsupported logging level: ${n}`);
      }
    }, Ot = (n) => n === "float32" || n === "float16" || n === "int32" || n === "int64" || n === "uint32" || n === "uint8" || n === "bool" || n === "uint4" || n === "int4", It = (n) => n === "float32" || n === "float16" || n === "int32" || n === "int64" || n === "uint32" || n === "uint64" || n === "int8" || n === "uint8" || n === "bool" || n === "uint4" || n === "int4", co = (n) => {
      switch (n) {
        case "none":
          return 0;
        case "cpu":
          return 1;
        case "cpu-pinned":
          return 2;
        case "texture":
          return 3;
        case "gpu-buffer":
          return 4;
        case "ml-tensor":
          return 5;
        default:
          throw new Error(`unsupported data location: ${n}`);
      }
    };
  });
  var Ke;
  var cn = N(() => {
    "use strict";
    dt();
    Ke = async (n) => {
      if (typeof n == "string") if (false) try {
        let { readFile: t } = Jt("node:fs/promises");
        return new Uint8Array(await t(n));
      } catch (t) {
        if (t.code === "ERR_FS_FILE_TOO_LARGE") {
          let { createReadStream: a } = Jt("node:fs"), u = a(n), o = [];
          for await (let d of u) o.push(d);
          return new Uint8Array(Buffer.concat(o));
        }
        throw t;
      }
      else {
        let t = await fetch(n);
        if (!t.ok) throw new Error(`failed to load external data file: ${n}`);
        let a = t.headers.get("Content-Length"), u = a ? parseInt(a, 10) : 0;
        if (u < 1073741824) return new Uint8Array(await t.arrayBuffer());
        {
          if (!t.body) throw new Error(`failed to load external data file: ${n}, no response body.`);
          let o = t.body.getReader(), d;
          try {
            d = new ArrayBuffer(u);
          } catch (l) {
            if (l instanceof RangeError) {
              let m = Math.ceil(u / 65536);
              d = new WebAssembly.Memory({ initial: m, maximum: m }).buffer;
            } else throw l;
          }
          let c = 0;
          for (; ; ) {
            let { done: l, value: m } = await o.read();
            if (l) break;
            let h = m.byteLength;
            new Uint8Array(d, c, h).set(m), c += h;
          }
          return new Uint8Array(d, 0, u);
        }
      }
      else return n instanceof Blob ? new Uint8Array(await n.arrayBuffer()) : n instanceof Uint8Array ? n : new Uint8Array(n);
    };
  });
  var ys;
  var ht;
  var wt;
  var $e;
  var gs;
  var lo;
  var Ze;
  var bt;
  var yt;
  var po;
  var gt;
  var Et;
  var Tt;
  var rn = N(() => {
    "use strict";
    Te();
    ao();
    io();
    fn();
    xe();
    vt();
    cn();
    ys = (n, t) => {
      z()._OrtInit(n, t) !== 0 && G("Can't initialize onnxruntime.");
    }, ht = async (n) => {
      ys(n.wasm.numThreads, fo(n.logLevel));
    }, wt = async (n, t) => {
      z().asyncInit?.();
      let a = n.webgpu.adapter;
      if (t === "webgpu") {
        if (typeof navigator > "u" || !navigator.gpu) throw new Error("WebGPU is not supported in current environment");
        if (a) {
          if (typeof a.limits != "object" || typeof a.features != "object" || typeof a.requestDevice != "function") throw new Error("Invalid GPU adapter set in `env.webgpu.adapter`. It must be a GPUAdapter object.");
        } else {
          let u = n.webgpu.powerPreference;
          if (u !== void 0 && u !== "low-power" && u !== "high-performance") throw new Error(`Invalid powerPreference setting: "${u}"`);
          let o = n.webgpu.forceFallbackAdapter;
          if (o !== void 0 && typeof o != "boolean") throw new Error(`Invalid forceFallbackAdapter setting: "${o}"`);
          if (a = await navigator.gpu.requestAdapter({ powerPreference: u, forceFallbackAdapter: o }), !a) throw new Error('Failed to get GPU adapter. You may need to enable flag "--enable-unsafe-webgpu" if you are using Chrome.');
        }
      }
      if (t === "webnn" && (typeof navigator > "u" || !navigator.ml)) throw new Error("WebNN is not supported in current environment");
    }, $e = /* @__PURE__ */ new Map(), gs = (n) => {
      let t = z(), a = t.stackSave();
      try {
        let u = t.PTR_SIZE, o = t.stackAlloc(2 * u);
        t._OrtGetInputOutputCount(n, o, o + u) !== 0 && G("Can't get session input/output count.");
        let c = u === 4 ? "i32" : "i64";
        return [Number(t.getValue(o, c)), Number(t.getValue(o + u, c))];
      } finally {
        t.stackRestore(a);
      }
    }, lo = (n, t) => {
      let a = z(), u = a.stackSave(), o = 0;
      try {
        let d = a.PTR_SIZE, c = a.stackAlloc(2 * d);
        a._OrtGetInputOutputMetadata(n, t, c, c + d) !== 0 && G("Can't get session input/output metadata.");
        let m = Number(a.getValue(c, "*"));
        o = Number(a.getValue(c + d, "*"));
        let h = a.HEAP32[o / 4];
        if (h === 0) return [m, 0];
        let g = a.HEAPU32[o / 4 + 1], b = [];
        for (let y = 0; y < g; y++) {
          let T = Number(a.getValue(o + 8 + y * d, "*"));
          b.push(T !== 0 ? a.UTF8ToString(T) : Number(a.getValue(o + 8 + (y + g) * d, "*")));
        }
        return [m, h, b];
      } finally {
        a.stackRestore(u), o !== 0 && a._OrtFree(o);
      }
    }, Ze = (n) => {
      let t = z(), a = t._malloc(n.byteLength);
      if (a === 0) throw new Error(`Can't create a session. failed to allocate a buffer of size ${n.byteLength}.`);
      return t.HEAPU8.set(n, a), [a, n.byteLength];
    }, bt = async (n, t) => {
      let a, u, o = z();
      Array.isArray(n) ? [a, u] = n : n.buffer === o.HEAPU8.buffer ? [a, u] = [n.byteOffset, n.byteLength] : [a, u] = Ze(n);
      let d = 0, c = 0, l = 0, m = [], h = [], g = [];
      try {
        if ([c, m] = await so(t), t?.externalData && o.mountExternalData) {
          let P = [];
          for (let k of t.externalData) {
            let w = typeof k == "string" ? k : k.path, Q = typeof k == "string" ? k : k.data;
            P.push(Ke(Q).then((H) => {
              o.mountExternalData(w, H);
            }));
          }
          await Promise.all(P);
        }
        for (let P of t?.executionProviders ?? []) if ((typeof P == "string" ? P : P.name) === "webnn") {
          if (o.shouldTransferToMLTensor = false, typeof P != "string") {
            let w = P, Q = w?.context, H = w?.gpuDevice, ne = w?.deviceType, pe = w?.powerPreference;
            Q ? o.currentContext = Q : H ? o.currentContext = await o.webnnCreateMLContext(H) : o.currentContext = await o.webnnCreateMLContext({ deviceType: ne, powerPreference: pe });
          } else o.currentContext = await o.webnnCreateMLContext();
          break;
        }
        d = await o._OrtCreateSession(a, u, c), o.webgpuOnCreateSession?.(d), d === 0 && G("Can't create a session."), o.jsepOnCreateSession?.(), o.currentContext && (o.webnnRegisterMLContext(d, o.currentContext), o.currentContext = void 0, o.shouldTransferToMLTensor = true);
        let [b, y] = gs(d), T = !!t?.enableGraphCapture, I = [], D = [], $ = [], v = [], A = [];
        for (let P = 0; P < b; P++) {
          let [k, w, Q] = lo(d, P);
          k === 0 && G("Can't get an input name."), h.push(k);
          let H = o.UTF8ToString(k);
          I.push(H), $.push(w === 0 ? { name: H, isTensor: false } : { name: H, isTensor: true, type: At(w), shape: Q });
        }
        for (let P = 0; P < y; P++) {
          let [k, w, Q] = lo(d, P + b);
          k === 0 && G("Can't get an output name."), g.push(k);
          let H = o.UTF8ToString(k);
          D.push(H), v.push(w === 0 ? { name: H, isTensor: false } : { name: H, isTensor: true, type: At(w), shape: Q });
        }
        return $e.set(d, [d, h, g, null, T, false]), [d, I, D, $, v];
      } catch (b) {
        throw h.forEach((y) => o._OrtFree(y)), g.forEach((y) => o._OrtFree(y)), l !== 0 && o._OrtReleaseBinding(l) !== 0 && G("Can't release IO binding."), d !== 0 && o._OrtReleaseSession(d) !== 0 && G("Can't release session."), b;
      } finally {
        o._free(a), c !== 0 && o._OrtReleaseSessionOptions(c) !== 0 && G("Can't release session options."), m.forEach((b) => o._free(b)), o.unmountExternalData?.();
      }
    }, yt = (n) => {
      let t = z(), a = $e.get(n);
      if (!a) throw new Error(`cannot release session. invalid session id: ${n}`);
      let [u, o, d, c, l] = a;
      c && (l && t._OrtClearBoundOutputs(c.handle) !== 0 && G("Can't clear bound outputs."), t._OrtReleaseBinding(c.handle) !== 0 && G("Can't release IO binding.")), t.jsepOnReleaseSession?.(n), t.webnnOnReleaseSession?.(n), t.webgpuOnReleaseSession?.(n), o.forEach((m) => t._OrtFree(m)), d.forEach((m) => t._OrtFree(m)), t._OrtReleaseSession(u) !== 0 && G("Can't release session."), $e.delete(n);
    }, po = async (n, t, a, u, o, d, c = false) => {
      if (!n) {
        t.push(0);
        return;
      }
      let l = z(), m = l.PTR_SIZE, h = n[0], g = n[1], b = n[3], y = b, T, I;
      if (h === "string" && (b === "gpu-buffer" || b === "ml-tensor")) throw new Error("String tensor is not supported on GPU.");
      if (c && b !== "gpu-buffer") throw new Error(`External buffer must be provided for input/output index ${d} when enableGraphCapture is true.`);
      if (b === "gpu-buffer") {
        let v = n[2].gpuBuffer;
        I = Ge(We(h), g);
        {
          let A = l.jsepRegisterBuffer;
          if (!A) throw new Error('Tensor location "gpu-buffer" is not supported without using WebGPU.');
          T = A(u, d, v, I);
        }
      } else if (b === "ml-tensor") {
        let v = n[2].mlTensor;
        I = Ge(We(h), g);
        let A = l.webnnRegisterMLTensor;
        if (!A) throw new Error('Tensor location "ml-tensor" is not supported without using WebNN.');
        T = A(u, v, We(h), g);
      } else {
        let v = n[2];
        if (Array.isArray(v)) {
          I = m * v.length, T = l._malloc(I), a.push(T);
          for (let A = 0; A < v.length; A++) {
            if (typeof v[A] != "string") throw new TypeError(`tensor data at index ${A} is not a string`);
            l.setValue(T + A * m, ae(v[A], a), "*");
          }
        } else {
          let A = l.webnnIsGraphInput, F = l.webnnIsGraphOutput;
          if (h !== "string" && A && F) {
            let P = l.UTF8ToString(o);
            if (A(u, P) || F(u, P)) {
              let k = We(h);
              I = Ge(k, g), y = "ml-tensor";
              let w = l.webnnCreateTemporaryTensor, Q = l.webnnUploadTensor;
              if (!w || !Q) throw new Error('Tensor location "ml-tensor" is not supported without using WebNN.');
              let H = await w(u, k, g);
              Q(H, new Uint8Array(v.buffer, v.byteOffset, v.byteLength)), T = H;
            } else I = v.byteLength, T = l._malloc(I), a.push(T), l.HEAPU8.set(new Uint8Array(v.buffer, v.byteOffset, I), T);
          } else I = v.byteLength, T = l._malloc(I), a.push(T), l.HEAPU8.set(new Uint8Array(v.buffer, v.byteOffset, I), T);
        }
      }
      let D = l.stackSave(), $ = l.stackAlloc(4 * g.length);
      try {
        g.forEach((A, F) => l.setValue($ + F * m, A, m === 4 ? "i32" : "i64"));
        let v = l._OrtCreateTensor(We(h), T, I, $, g.length, co(y));
        v === 0 && G(`Can't create tensor for input/output. session=${u}, index=${d}.`), t.push(v);
      } finally {
        l.stackRestore(D);
      }
    }, gt = async (n, t, a, u, o, d) => {
      let c = z(), l = c.PTR_SIZE, m = $e.get(n);
      if (!m) throw new Error(`cannot run inference. invalid session id: ${n}`);
      let h = m[0], g = m[1], b = m[2], y = m[3], T = m[4], I = m[5], D = t.length, $ = u.length, v = 0, A = [], F = [], P = [], k = [], w = [], Q = c.stackSave(), H = c.stackAlloc(D * l), ne = c.stackAlloc(D * l), pe = c.stackAlloc($ * l), B = c.stackAlloc($ * l);
      try {
        [v, A] = oo(d), Pe("wasm prepareInputOutputTensor");
        for (let O = 0; O < D; O++) await po(a[O], F, k, n, g[t[O]], t[O], T);
        for (let O = 0; O < $; O++) await po(o[O], P, k, n, b[u[O]], D + u[O], T);
        Ue("wasm prepareInputOutputTensor");
        for (let O = 0; O < D; O++) c.setValue(H + O * l, F[O], "*"), c.setValue(ne + O * l, g[t[O]], "*");
        for (let O = 0; O < $; O++) c.setValue(pe + O * l, P[O], "*"), c.setValue(B + O * l, b[u[O]], "*");
        c.jsepOnRunStart?.(h), c.webnnOnRunStart?.(h);
        let W;
        W = await c._OrtRun(h, ne, H, D, B, $, pe, v), W !== 0 && G("failed to call OrtRun().");
        let re = [], me = [];
        Pe("wasm ProcessOutputTensor");
        for (let O = 0; O < $; O++) {
          let K = Number(c.getValue(pe + O * l, "*"));
          if (K === P[O] || w.includes(P[O])) {
            re.push(o[O]), K !== P[O] && c._OrtReleaseTensor(K) !== 0 && G("Can't release tensor.");
            continue;
          }
          let je = c.stackSave(), ee = c.stackAlloc(4 * l), he = false, j, J = 0;
          try {
            c._OrtGetTensorData(K, ee, ee + l, ee + 2 * l, ee + 3 * l) !== 0 && G(`Can't access output tensor data on index ${O}.`);
            let Se = l === 4 ? "i32" : "i64", ve = Number(c.getValue(ee, Se));
            J = c.getValue(ee + l, "*");
            let Ve = c.getValue(ee + l * 2, "*"), Re = Number(c.getValue(ee + l * 3, Se)), te = [];
            for (let L = 0; L < Re; L++) te.push(Number(c.getValue(Ve + L * l, Se)));
            c._OrtFree(Ve) !== 0 && G("Can't free memory for tensor dims.");
            let ue = te.reduce((L, V) => L * V, 1);
            j = At(ve);
            let se = y?.outputPreferredLocations[u[O]];
            if (j === "string") {
              if (se === "gpu-buffer" || se === "ml-tensor") throw new Error("String tensor is not supported on GPU.");
              let L = [];
              for (let V = 0; V < ue; V++) {
                let fe = c.getValue(J + V * l, "*"), ye = c.getValue(J + (V + 1) * l, "*"), ce = V === ue - 1 ? void 0 : ye - fe;
                L.push(c.UTF8ToString(fe, ce));
              }
              re.push([j, te, L, "cpu"]);
            } else if (se === "gpu-buffer" && ue > 0) {
              let L = c.jsepGetBuffer;
              if (!L) throw new Error('preferredLocation "gpu-buffer" is not supported without using WebGPU.');
              let V = L(J), fe = Ge(ve, ue);
              if (fe === void 0 || !Ot(j)) throw new Error(`Unsupported data type: ${j}`);
              he = true, re.push([j, te, { gpuBuffer: V, download: c.jsepCreateDownloader(V, fe, j), dispose: () => {
                c._OrtReleaseTensor(K) !== 0 && G("Can't release tensor.");
              } }, "gpu-buffer"]);
            } else if (se === "ml-tensor" && ue > 0) {
              let L = c.webnnEnsureTensor, V = c.webnnIsGraphInputOutputTypeSupported;
              if (!L || !V) throw new Error('preferredLocation "ml-tensor" is not supported without using WebNN.');
              if (Ge(ve, ue) === void 0 || !It(j)) throw new Error(`Unsupported data type: ${j}`);
              if (!V(n, j, false)) throw new Error(`preferredLocation "ml-tensor" for ${j} output is not supported by current WebNN Context.`);
              let ye = await L(n, J, ve, te, false);
              he = true, re.push([j, te, { mlTensor: ye, download: c.webnnCreateMLTensorDownloader(J, j), dispose: () => {
                c.webnnReleaseTensorId(J), c._OrtReleaseTensor(K);
              } }, "ml-tensor"]);
            } else if (se === "ml-tensor-cpu-output" && ue > 0) {
              let L = c.webnnCreateMLTensorDownloader(J, j)(), V = re.length;
              he = true, me.push((async () => {
                let fe = [V, await L];
                return c.webnnReleaseTensorId(J), c._OrtReleaseTensor(K), fe;
              })()), re.push([j, te, [], "cpu"]);
            } else {
              let L = uo(j), V = new L(ue);
              new Uint8Array(V.buffer, V.byteOffset, V.byteLength).set(c.HEAPU8.subarray(J, J + V.byteLength)), re.push([j, te, V, "cpu"]);
            }
          } finally {
            c.stackRestore(je), j === "string" && J && c._free(J), he || c._OrtReleaseTensor(K);
          }
        }
        y && !T && (c._OrtClearBoundOutputs(y.handle) !== 0 && G("Can't clear bound outputs."), $e.set(n, [h, g, b, y, T, false]));
        for (let [O, K] of await Promise.all(me)) re[O][2] = K;
        return Ue("wasm ProcessOutputTensor"), re;
      } finally {
        c.webnnOnRunEnd?.(h), c.stackRestore(Q), F.forEach((W) => c._OrtReleaseTensor(W)), P.forEach((W) => c._OrtReleaseTensor(W)), k.forEach((W) => c._free(W)), v !== 0 && c._OrtReleaseRunOptions(v), A.forEach((W) => c._free(W));
      }
    }, Et = (n) => {
      let t = z(), a = $e.get(n);
      if (!a) throw new Error("invalid session id");
      let u = a[0], o = t._OrtEndProfiling(u);
      o === 0 && G("Can't get an profile file name."), t._OrtFree(o);
    }, Tt = (n) => {
      let t = [];
      for (let a of n) {
        let u = a[2];
        !Array.isArray(u) && "buffer" in u && t.push(u.buffer);
      }
      return t;
    };
  });
  var Me;
  var ie;
  var et;
  var Lt;
  var _t;
  var Bt;
  var ln;
  var dn;
  var ze;
  var He;
  var Ts;
  var mo;
  var ho;
  var wo;
  var bo;
  var yo;
  var go;
  var Eo;
  var pn = N(() => {
    "use strict";
    Te();
    rn();
    xe();
    pt();
    Me = () => !!Y.wasm.proxy && typeof document < "u", et = false, Lt = false, _t = false, dn = /* @__PURE__ */ new Map(), ze = (n, t) => {
      let a = dn.get(n);
      a ? a.push(t) : dn.set(n, [t]);
    }, He = () => {
      if (et || !Lt || _t || !ie) throw new Error("worker not ready");
    }, Ts = (n) => {
      switch (n.data.type) {
        case "init-wasm":
          et = false, n.data.err ? (_t = true, ln[1](n.data.err)) : (Lt = true, ln[0]()), Bt && (URL.revokeObjectURL(Bt), Bt = void 0);
          break;
        case "init-ep":
        case "copy-from":
        case "create":
        case "release":
        case "run":
        case "end-profiling": {
          let t = dn.get(n.data.type);
          n.data.err ? t.shift()[1](n.data.err) : t.shift()[0](n.data.out);
          break;
        }
        default:
      }
    }, mo = async () => {
      if (!Lt) {
        if (et) throw new Error("multiple calls to 'initWasm()' detected.");
        if (_t) throw new Error("previous call to 'initWasm()' failed.");
        if (et = true, Me()) return new Promise((n, t) => {
          ie?.terminate(), to().then(([a, u]) => {
            try {
              ie = u, ie.onerror = (d) => t(d), ie.onmessage = Ts, ln = [n, t];
              let o = { type: "init-wasm", in: Y };
              !o.in.wasm.wasmPaths && (a || an) && (o.in.wasm.wasmPaths = { wasm: new URL("ort-wasm-simd-threaded.wasm", void 0).href }), ie.postMessage(o), Bt = a;
            } catch (o) {
              t(o);
            }
          }, t);
        });
        try {
          await mt(Y.wasm), await ht(Y), Lt = true;
        } catch (n) {
          throw _t = true, n;
        } finally {
          et = false;
        }
      }
    }, ho = async (n) => {
      if (Me()) return He(), new Promise((t, a) => {
        ze("init-ep", [t, a]);
        let u = { type: "init-ep", in: { epName: n, env: Y } };
        ie.postMessage(u);
      });
      await wt(Y, n);
    }, wo = async (n) => Me() ? (He(), new Promise((t, a) => {
      ze("copy-from", [t, a]);
      let u = { type: "copy-from", in: { buffer: n } };
      ie.postMessage(u, [n.buffer]);
    })) : Ze(n), bo = async (n, t) => {
      if (Me()) {
        if (t?.preferredOutputLocation) throw new Error('session option "preferredOutputLocation" is not supported for proxy.');
        return He(), new Promise((a, u) => {
          ze("create", [a, u]);
          let o = { type: "create", in: { model: n, options: { ...t } } }, d = [];
          n instanceof Uint8Array && d.push(n.buffer), ie.postMessage(o, d);
        });
      } else return bt(n, t);
    }, yo = async (n) => {
      if (Me()) return He(), new Promise((t, a) => {
        ze("release", [t, a]);
        let u = { type: "release", in: n };
        ie.postMessage(u);
      });
      yt(n);
    }, go = async (n, t, a, u, o, d) => {
      if (Me()) {
        if (a.some((c) => c[3] !== "cpu")) throw new Error("input tensor on GPU is not supported for proxy.");
        if (o.some((c) => c)) throw new Error("pre-allocated output tensor is not supported for proxy.");
        return He(), new Promise((c, l) => {
          ze("run", [c, l]);
          let m = a, h = { type: "run", in: { sessionId: n, inputIndices: t, inputs: m, outputIndices: u, options: d } };
          ie.postMessage(h, Tt(m));
        });
      } else return gt(n, t, a, u, o, d);
    }, Eo = async (n) => {
      if (Me()) return He(), new Promise((t, a) => {
        ze("end-profiling", [t, a]);
        let u = { type: "end-profiling", in: n };
        ie.postMessage(u);
      });
      Et(n);
    };
  });
  var To;
  var Ss;
  var Dt;
  var So = N(() => {
    "use strict";
    Te();
    pn();
    fn();
    dt();
    cn();
    To = (n, t) => {
      switch (n.location) {
        case "cpu":
          return [n.type, n.dims, n.data, "cpu"];
        case "gpu-buffer":
          return [n.type, n.dims, { gpuBuffer: n.gpuBuffer }, "gpu-buffer"];
        case "ml-tensor":
          return [n.type, n.dims, { mlTensor: n.mlTensor }, "ml-tensor"];
        default:
          throw new Error(`invalid data location: ${n.location} for ${t()}`);
      }
    }, Ss = (n) => {
      switch (n[3]) {
        case "cpu":
          return new de(n[0], n[2], n[1]);
        case "gpu-buffer": {
          let t = n[0];
          if (!Ot(t)) throw new Error(`not supported data type: ${t} for deserializing GPU tensor`);
          let { gpuBuffer: a, download: u, dispose: o } = n[2];
          return de.fromGpuBuffer(a, { dataType: t, dims: n[1], download: u, dispose: o });
        }
        case "ml-tensor": {
          let t = n[0];
          if (!It(t)) throw new Error(`not supported data type: ${t} for deserializing MLTensor tensor`);
          let { mlTensor: a, download: u, dispose: o } = n[2];
          return de.fromMLTensor(a, { dataType: t, dims: n[1], download: u, dispose: o });
        }
        default:
          throw new Error(`invalid data location: ${n[3]}`);
      }
    }, Dt = class {
      async fetchModelAndCopyToWasmMemory(t) {
        return wo(await Ke(t));
      }
      async loadModel(t, a) {
        _e();
        let u;
        typeof t == "string" ? u = await this.fetchModelAndCopyToWasmMemory(t) : u = t, [this.sessionId, this.inputNames, this.outputNames, this.inputMetadata, this.outputMetadata] = await bo(u, a), De();
      }
      async dispose() {
        return yo(this.sessionId);
      }
      async run(t, a, u) {
        _e();
        let o = [], d = [];
        Object.entries(t).forEach((y) => {
          let T = y[0], I = y[1], D = this.inputNames.indexOf(T);
          if (D === -1) throw new Error(`invalid input '${T}'`);
          o.push(I), d.push(D);
        });
        let c = [], l = [];
        Object.entries(a).forEach((y) => {
          let T = y[0], I = y[1], D = this.outputNames.indexOf(T);
          if (D === -1) throw new Error(`invalid output '${T}'`);
          c.push(I), l.push(D);
        });
        let m = o.map((y, T) => To(y, () => `input "${this.inputNames[d[T]]}"`)), h = c.map((y, T) => y ? To(y, () => `output "${this.outputNames[l[T]]}"`) : null), g = await go(this.sessionId, d, m, l, h, u), b = {};
        for (let y = 0; y < g.length; y++) b[this.outputNames[l[y]]] = c[y] ?? Ss(g[y]);
        return De(), b;
      }
      startProfiling() {
      }
      endProfiling() {
        Eo(this.sessionId);
      }
    };
  });
  var Ao = {};
  ut(Ao, { OnnxruntimeWebAssemblyBackend: () => Pt, initializeFlags: () => vo, wasmBackend: () => vs });
  var vo;
  var Pt;
  var vs;
  var Oo = N(() => {
    "use strict";
    Te();
    pn();
    So();
    vo = () => {
      (typeof Y.wasm.initTimeout != "number" || Y.wasm.initTimeout < 0) && (Y.wasm.initTimeout = 0);
      let n = Y.wasm.simd;
      if (typeof n != "boolean" && n !== void 0 && n !== "fixed" && n !== "relaxed" && (console.warn(`Property "env.wasm.simd" is set to unknown value "${n}". Reset it to \`false\` and ignore SIMD feature checking.`), Y.wasm.simd = false), typeof Y.wasm.proxy != "boolean" && (Y.wasm.proxy = false), typeof Y.wasm.trace != "boolean" && (Y.wasm.trace = false), typeof Y.wasm.numThreads != "number" || !Number.isInteger(Y.wasm.numThreads) || Y.wasm.numThreads <= 0) if (typeof self < "u" && !self.crossOriginIsolated) Y.wasm.numThreads = 1;
      else {
        let t = typeof navigator > "u" ? Jt("node:os").cpus().length : navigator.hardwareConcurrency;
        Y.wasm.numThreads = Math.min(4, Math.ceil((t || 1) / 2));
      }
    }, Pt = class {
      async init(t) {
        vo(), await mo(), await ho(t);
      }
      async createInferenceSessionHandler(t, a) {
        let u = new Dt();
        return await u.loadModel(t, a), u;
      }
    }, vs = new Pt();
  });
  Te();
  Te();
  Te();
  var $r = "1.30.0";
  {
    let n = (Oo(), Xt(Ao)).wasmBackend;
    Je("cpu", n, 10), Je("wasm", n, 10);
  }
  Object.defineProperty(Y.versions, "web", { value: $r, enumerable: true });

  // src/ocr-assets.json
  var ocr_assets_default = {
    model: { path: "ddddocr-node@2.3.0/onnx/common_old.onnx", bytes: 13606051, sha256: "b8f2ad9cbc1f2e3922a6cb9459e30824e7e2467f3fb4fd61420640e34ea0bf68" },
    charset: { path: "ddddocr-node@2.3.0/onnx/common_old.json", bytes: 90091, sha256: "9828b658125f45070969214957acf173ef778994089c10dddb03d1f6c136a9be" },
    wasm: { path: "onnxruntime-web@1.30.0/dist/ort-wasm-simd-threaded.wasm", bytes: 14239897, sha256: "3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2" }
  };

  // src/ocr-assets.ts
  var OCR_ASSETS = ocr_assets_default;
  var CACHE = "seu-lecture-ocr-v1";
  async function validAsset(buffer, asset) {
    if (buffer.byteLength !== asset.bytes) return false;
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
    return [...hash].map((x) => x.toString(16).padStart(2, "0")).join("") === asset.sha256;
  }
  async function loadAsset(asset) {
    const urls = ["https://cdn.jsdelivr.net/npm/", "https://unpkg.com/"].map((prefix) => prefix + asset.path);
    let cache;
    try {
      cache = await caches.open(CACHE);
      const hit = await cache.match(urls[0]);
      if (hit) {
        const buffer = await hit.arrayBuffer();
        if (await validAsset(buffer, asset)) return buffer;
        await cache.delete(urls[0]);
      }
    } catch {
    }
    for (const url of urls) {
      try {
        const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(6e4) });
        if (!response.ok) throw new Error("\u8D44\u6E90\u4E0B\u8F7D\u5931\u8D25");
        const buffer = await response.arrayBuffer();
        if (!await validAsset(buffer, asset)) throw new Error("\u8D44\u6E90\u6821\u9A8C\u5931\u8D25");
        try {
          await cache?.put(urls[0], new Response(buffer));
        } catch {
        }
        return buffer;
      } catch {
      }
    }
    throw new Error("OCR \u8D44\u6E90\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u4F7F\u7528\u624B\u52A8\u8F93\u5165\uFF0C\u7A0D\u540E\u91CD\u65B0\u6253\u5F00\u5F39\u7A97\u91CD\u8BD5");
  }

  // src/ocr.ts
  var MODE_KEY = "seu-lecture-helper-input-mode";
  function savedMode() {
    try {
      return localStorage.getItem(MODE_KEY) === "manual" ? "manual" : "ocr";
    } catch {
      return "ocr";
    }
  }
  function saveMode(mode) {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
    }
  }
  function decodeCtc(data, dims, charset) {
    if (dims.length !== 3 || dims[1] !== 1 || dims[2] !== charset.length) throw new Error("OCR \u6A21\u578B\u8F93\u51FA\u683C\u5F0F\u4E0D\u5339\u914D");
    let previous = 0, text = "";
    for (let t = 0; t < dims[0]; t++) {
      let best = 0;
      for (let c = 1; c < dims[2]; c++) if (data[t * dims[2] + c] > data[t * dims[2] + best]) best = c;
      if (best !== 0 && best !== previous) text += charset[best];
      previous = best;
    }
    return text;
  }
  var BrowserOcr = class {
    preparing;
    session;
    charset = [];
    prepare() {
      if (!this.preparing) this.preparing = this.initialize().catch((error) => {
        this.preparing = void 0;
        throw error;
      });
      return this.preparing;
    }
    async initialize() {
      const [model, charset, wasm] = await Promise.all([loadAsset(OCR_ASSETS.model), loadAsset(OCR_ASSETS.charset), loadAsset(OCR_ASSETS.wasm)]);
      this.charset = JSON.parse(new TextDecoder().decode(charset));
      Y.wasm.numThreads = 1;
      Y.wasm.proxy = false;
      Y.wasm.wasmPaths = void 0;
      Y.wasm.wasmBinary = wasm;
      this.session = await rs.create(new Uint8Array(model), { executionProviders: ["wasm"] });
      const input = new de("float32", new Float32Array(64 * 128).fill(1), [1, 1, 64, 128]);
      try {
        const outputs = await this.session.run({ [this.session.inputNames[0]]: input });
        Object.values(outputs).forEach((output) => output.dispose());
      } finally {
        input.dispose();
      }
    }
    async recognize(data) {
      await this.prepare();
      const image = new Image();
      image.src = data;
      await image.decode();
      const height = 64, width = Math.floor(image.width * height / image.height);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data, floats = new Float32Array(width * height);
      for (let p = 0; p < floats.length; p++) {
        const i = p * 4;
        floats[p] = ((0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255 - 0.5) / 0.5;
      }
      const input = new de("float32", floats, [1, 1, height, width]);
      try {
        const session = this.session;
        const outputs = await session.run({ [session.inputNames[0]]: input });
        try {
          return decodeCtc(outputs[session.outputNames[0]].data, outputs[session.outputNames[0]].dims, this.charset);
        } finally {
          Object.values(outputs).forEach((output) => output.dispose());
        }
      } finally {
        input.dispose();
      }
    }
  };

  // src/main.ts
  if (!document.documentElement.hasAttribute("data-seu-lecture-helper")) {
    let notice = function(text) {
      document.getElementById("seu-lecture-helper-notice")?.remove();
      const item = document.createElement("div");
      item.id = "seu-lecture-helper-notice";
      item.setAttribute("role", "status");
      item.textContent = text;
      item.style.cssText = "position:fixed;bottom:30px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#234d35;color:white;padding:14px;border-radius:10px;max-width:80vw";
      document.body.append(item);
      setTimeout(() => item.remove(), 6e3);
    }, close = function() {
      if (current?.task.close()) {
        current.dialog.destroy();
        current.release();
        current = void 0;
      }
    };
    notice2 = notice, close2 = close;
    document.documentElement.setAttribute("data-seu-lecture-helper", "0.3.3");
    const api = new Api();
    const ocr = new BrowserOcr();
    let current;
    let opening = false;
    async function open(id) {
      if (current?.task.state.activity?.id === id) {
        current.dialog.show();
        return;
      }
      if (opening || current) {
        notice("\u8BF7\u5148\u5B8C\u6210\u6216\u5173\u95ED\u5F53\u524D\u9884\u7EA6\u4EFB\u52A1");
        return;
      }
      opening = true;
      let release = null;
      try {
        release = await acquireTask();
        if (!release) {
          notice("\u53E6\u4E00\u4E2A\u6807\u7B7E\u9875\u6B63\u5728\u8FDB\u884C\u9884\u7EA6\uFF0C\u8BF7\u5148\u5173\u95ED\u90A3\u91CC\u7684\u4EFB\u52A1");
          return;
        }
        const task = new Reservation(api, (state) => {
          if (state.activity && state.phase !== "closed") mount.setReserved(state.activity.id, state.activity.reserved);
          const label = state.phase === "monitoring" ? "\u76D1\u6D4B\u4E2D" : state.phase === "paused" ? "\u5DF2\u6682\u505C" : state.phase === "waiting" ? "\u7B49\u5F85\u4E2D" : ["captcha-loading", "recognizing", "input", "submitting", "verifying"].includes(state.phase) ? "\u9884\u7EA6\u4E2D" : "";
          mount.setActive(label ? state.activity?.id : void 0, label);
          current?.dialog.render(state);
        }, Date.now, () => true, ocr, savedMode());
        const dialog = new Dialog({
          submit: (code) => {
            void task.submit(code);
          },
          refresh: () => {
            void task.loadCaptcha();
          },
          verify: () => {
            void task.verify();
          },
          close,
          mode: (mode) => {
            task.setMode(mode);
            if (task.state.taskMode !== "monitor") saveMode(task.state.mode);
          },
          reload: () => location.reload(),
          start: () => task.start(),
          pause: () => task.pause(),
          checkNow: () => task.checkNow(),
          configure: (options) => task.configure(options),
          hide: () => dialog.hide()
        });
        current = { task, dialog, release };
        void task.open(id, false);
      } catch (error) {
        release?.();
        notice(message(error));
      } finally {
        opening = false;
      }
    }
    const mount = new Mount(api, (id) => {
      void open(id);
    }, close);
    mount.start();
    window.addEventListener("pagehide", () => {
      mount.stop();
      close();
    });
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) mount.start();
    });
  }
  var notice2;
  var close2;
})();
