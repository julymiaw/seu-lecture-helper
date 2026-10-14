# 开发与发布

Node.js 22 或以上：

```sh
npm ci
npm run check
```

`npm run check` 执行类型检查、单元／DOM 测试、构建和离线浏览器测试。浏览器测试准备阶段需下载公开 OCR 资源，之后学校和 CDN 请求全部由本地样例拦截。macOS 优先使用已安装 Chrome，可用 `CHROME_PATH` 指定；其他系统先运行 `npx playwright install chromium`。

类型检查启用未使用变量和参数检查。`experiments/ocr/` 保留预训练模型评估工具，历史设计、评估与采集文档保留为依据，不参与用户脚本构建；无需为了缩小安装包删除这些资料。当前生产流程以 `src/main.ts` 为唯一构建入口。

## 结构

- `src/api.ts`：同源请求、数据解析与预约核验。
- `src/reservation.ts`：提前取图、倒计时、答案修正、重试与提交。
- `src/task-store.ts`：同一标签页的任务意图保存与恢复，不保存验证码。
- `src/dialog.ts`：独立弹窗与输入事件。
- `src/ocr.ts`、`ocr-assets.*`：本地推理、资源校验与缓存。
- `src/diagnostics.ts`：Console 事件与阶段耗时。
- `src/mount.ts`、`lock.ts`、`main.ts`：按钮挂载、跨标签页互斥与初始化。
- `tests/`：接口样例、状态机、DOM 和真实 WASM／模型的离线浏览器测试。
- `dist/seu-lecture-helper.user.js`：构建产物。

## 发布约定

README.md 是 GitHub 和 Greasy Fork 唯一共用的介绍，使用完整网址，原样发布，不维护平台专用副本。CHANGELOG.md 只写版本差异，不加链接、教程或测试记录。修改代码版本时同时提交对应更新日志和构建产物；将对应版本条目复制到 Greasy Fork 的更新日志输入框。

提前取图与验证码有效期、高峰性能仍需实网验收。离线通过不代表学校服务端保证验证码能提前保留指定秒数。旧监测设计与页面采集文档为历史证据，不代表 0.4.0 功能。
