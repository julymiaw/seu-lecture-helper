# 开发与发布

Node.js 22 或以上：

```sh
npm ci
npm run check
```

`npm run check` 执行类型检查、单元／DOM 测试、构建和离线浏览器测试。浏览器测试准备阶段需下载公开 OCR 资源，之后学校和 CDN 请求全部由本地样例拦截。macOS 优先使用已安装 Chrome，可用 `CHROME_PATH` 指定；其他系统先运行 `npx playwright install chromium`。

类型检查启用未使用变量和参数检查。`experiments/ocr/` 保留预训练模型评估工具，历史评估与采集文档保留为依据，不参与用户脚本构建；无需为了缩小安装包删除这些资料。当前生产流程以 `src/main.ts` 为唯一构建入口。

## 结构

- `src/api.ts`：同源请求、数据解析与预约核验。
- `src/reservation.ts`：提前取图、倒计时、OCR 自动重试与提交。
- `src/task-store.ts`：同一标签页的任务意图保存与恢复，不保存验证码。
- `src/candidates.ts`：标题元数据解析、唯一场次配对与顺序。
- `src/dialog.ts`：独立弹窗、统一场次状态与操作事件。
- `src/ocr.ts`、`ocr-assets.*`：本地推理、资源校验与缓存。
- `src/diagnostics.ts`、`log-store.ts`：结构化事件、阶段耗时、本地 JSON 缓存与导出。
- `src/mount.ts`、`lock.ts`、`main.ts`：按钮挂载、跨标签页互斥与初始化。
- `tests/`：接口样例、状态机、DOM 和真实 WASM／模型的离线浏览器测试。
- `dist/seu-lecture-helper.user.js`：构建产物。

## 发布约定

README.md 是 GitHub 和 Greasy Fork 唯一共用的介绍，使用完整网址，原样发布，不维护平台专用副本。CHANGELOG.md 只写版本差异，不加链接、教程或测试记录。修改代码版本时同时提交对应更新日志和构建产物；将对应版本条目复制到 Greasy Fork 的更新日志输入框。

提前取图与验证码有效期、高峰性能仍需实网验收。离线通过不代表学校服务端保证验证码能提前保留指定秒数。旧监测设计与页面采集文档为历史证据，不代表当前功能。

## 本地交互演示

运行 `npm run prepare:ocr-tests` 准备已固定并校验的公开资源，再运行 `npm run preview`，使用 Chrome 打开 `http://127.0.0.1:8768/index.do#/hdyy`。模拟页加载当前构建产物；学校接口返回本地样例，OCR 从本机缓存加载，外部连接由页面策略阻止。模拟线上满员、线下成功，重置按钮仅清理演示站点任务。它验证交互及样例分支，不验证真实登录态、学校接口或已安装扩展的域名匹配。

恢复记录仅在序列化内容变化时写入；倒计时和 OCR 阶段变化本身不改变恢复意图。提交前必须保存 verify 屏障，切换候选立即保存当前索引；写入失败不能记为已保存。旧恢复记录中的提前量字段忽略，实际取图仍固定开放前 30 秒。
