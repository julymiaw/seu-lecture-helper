# 开发与发布

## 开发与测试

Node.js 22 或以上：

```sh
npm ci
npm run typecheck
npm test
npm run build
```

最终产物为 `dist/seu-lecture-helper.user.js`，包含 JavaScript、WASM 加载器、样式与第三方许可。模型和 WASM 二进制按固定版本从 jsDelivr 下载，失败时尝试 UNPKG 一次；每个资源校验固定大小与 SHA-256。没有运行时远程 JavaScript，也不会向资源站点发送学校 Cookie、验证码或页面地址。

浏览器测试使用隔离 Chrome／Chromium，测试运行时所有请求均由样例拦截，不连接学校。测试准备阶段需要下载公开模型与 WASM（本机已有离线实验依赖时直接校验并复用），存入忽略发布的 `.cache/ocr/`；准备完后测试本身离线运行：

```sh
npx playwright install chromium
npm run test:e2e
# 类型检查、单元/DOM 测试、构建、浏览器测试
npm run check
```

macOS 默认使用已安装的 Google Chrome；也可设置 `CHROME_PATH` 指定可执行文件。其他系统默认使用 Playwright 的 Chromium。GitHub Actions 配置运行相同离线检查。

## 结构

```text
src/
  api.ts             接口与数据解析
  reservation.ts     倒计时、余位监测、验证码、提交与核验状态
  dialog.ts          自建弹窗与键盘操作
  ocr.ts             浏览器识别、预热与模式偏好
  ocr-assets.*       固定资源版本、完整性校验和缓存
  mount.ts           列表/详情页按钮适配
  lock.ts            浏览器跨标签页任务互斥
  main.ts            初始化
scripts/build.mjs    单文件构建
tests/              单元、DOM、浏览器测试与最小样例
docs/               接口依据、设计、测试范围
dist/               可安装产物
```

## 范围与验证

离线检查覆盖满员→余位释放、暂停／继续、立即检查、运行中修改间隔、慢请求不重叠、退避与登录／限流暂停、收起／自动展开、定时衔接，以及接口编码、活动关联、倒计时、防重复提交、验证码错误、超时后成功、结果不明、路由挂载、窄屏与跨标签页互斥，以及真实模型／WASM 推理、资源缓存、自动提交和手动回退。最新数量与环境见 [测试结果](https://github.com/julymiaw/seu-lecture-helper/blob/main/docs/test-results.md)。

长期后台监测、捡漏效果及高峰性能尚未完成实网验收。省略 `appiontCheck` 有已采集的详情页源码依据。接口变化、用户脚本管理器的执行环境和验证码时效仍须区分于离线测试结果。

脚本不保存密码、Cookie 或验证码，只保存模式偏好及公开 OCR 资源。监测仅由用户启动，不引入自动登录、固定保活或取消预约。人数行缺失时会继续等待数据，不把它当作真实零人数自动提交。网络失败按 2／4／8／8 分钟退避，第五次失败暂停；登录、限流及未知业务异常暂停。列表挂载优先只读 Vue 组件的活动 ID，无法读取时按完整标题、地点和活动时间唯一匹配；歧义时不绑定错误目标。要求支持 HTML dialog、Web Locks 和 WASM SIMD 的新版 Chrome/Edge；未验证其他浏览器。学校 CSP 或网络策略如限制外部资源，OCR 会显示失败并回退手动；不要将离线检查当作实际管理器／学校页面验收。

资料见 [接口记录](https://github.com/julymiaw/seu-lecture-helper/blob/main/docs/api.md)、[设计](https://github.com/julymiaw/seu-lecture-helper/blob/main/docs/design.md)、[OCR 设计](https://github.com/julymiaw/seu-lecture-helper/blob/main/docs/ocr.md)、[测试计划](https://github.com/julymiaw/seu-lecture-helper/blob/main/docs/test-plan.md)、[测试结果](https://github.com/julymiaw/seu-lecture-helper/blob/main/docs/test-results.md) 和 [采集记录](https://github.com/julymiaw/seu-lecture-helper/blob/main/docs/research.md)。发布时将仓库根目录 README.md 原样作为 Greasy Fork 介绍；CHANGELOG.md 中对应版本的条目原样作为版本更新日志。修改代码版本时，同时提交对应更新日志，不另行维护平台专用文案。测试数据来源见 [manifest](https://github.com/julymiaw/seu-lecture-helper/blob/main/tests/fixtures/manifest.json)。项目使用 MIT 许可，第三方推理引擎和模型来源见 [许可声明](https://github.com/julymiaw/seu-lecture-helper/blob/main/THIRD_PARTY_NOTICES.txt)。上级目录的研究证据不属于此仓库发布内容。

