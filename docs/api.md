# 接口记录

核对日期：2026-10-12（Asia/Shanghai）。由已登录会话实测与当前前端源码整理，并非学校发布的官方接口规范。

## 通信约定

- 同源前缀：`/gsapp/sys/yddjzxxtjappseu/modules/hdyy/`。
- 浏览器 `fetch` 使用 `credentials: 'same-origin'` 或 `include`；不导出 Cookie，不手动设置 Cookie、Origin、Referer 等受限头。
- POST 表单：`application/x-www-form-urlencoded;charset=UTF-8`，用 `URLSearchParams` 编码。本次成功提交另带 `X-Requested-With: XMLHttpRequest`；是否必需未单独验证。
- 普通响应外壳：`{code, datas, msg, debugException}`。HTTP 200 不等于业务成功。忽略 `debugException` 的内部细节，不向用户或日志输出凭据。
- 网络错误、超时、非 JSON 响应与业务失败分别处理；服务端具体登录失效和限流响应格式尚未采集，不臆造固定错误码。

## 请求清单

| 接口 | 方法及参数 | 成功响应的关键结构 | 证据 |
|---|---|---|---|
| `queryActivityList.do` | POST，空表单 | `code:0, datas:{xtdqsj,hdlbList,hdrsList,xsxxList,...}` | 前次实际响应、当前列表源码 |
| `getActivityDetail.do` | POST，`wid` | `datas:{hdxq,xtdqsj,wycspzList,...}` | 当前详情源码；本轮未取得新成功响应 |
| `vcode.do` | GET，`_` 为当前毫秒时间戳 | `code:0, datas:"data:image/jpeg;base64,..."` | 前次实际响应 |
| `addReservation.do` | POST，`wid,vcode` | `code:0, datas:1, msg:"", debugException:null` | 前次直接网络预约成功响应 |
| `queryMyActivityList.do` | POST，`param` 为 JSON 字符串，如 `{"FBZT":"1"}` | `code:0, datas:{xtdqsj,wdhdList,...}` | 前次实际响应、当前列表源码 |
| `appiontCheck.do` | GET，`wid` | 本次观察 `code:0,datas:null,msg:""` | 前次与随后只读实测；第一版不调用 |
| `deleteReservation.do` | POST，`wid` | `code:0,datas:1` | 前次往返测试；产品不实现 |

表中的 `param` 是表单字段，不能把其内部 JSON 当作整个请求的 JSON body；预约提交的字段是小写 `wid`，不是 `HD_WID`。

## 活动数据与预约状态

2026-10-12 21:49 再次读取当前已加载前端并查询一次列表，确认满员条件、人数来源及页面人数可滞后的现象，见 [当前人数证据](capacity-evidence.md)。

`hdlbList` 活动字段：

| 字段 | 含义／处理 |
|---|---|
| `WID` | 活动 ID，唯一目标；不得按数组序号或模糊标题预约 |
| `JZMC`,`JZDD`,`ZJR`,`JZXL_DISPLAY` | 标题、地点、主讲、类别 |
| `YYKSSJ`,`YYJSSJ` | 预约起止，观察格式 `YYYY-MM-DD HH:mm:ss` |
| `JZSJ`,`HDJSSJ` | 活动起止 |
| `HDZRS` | 总容量，样例为数字字符串 |
| `FBZT` | 前端将 `-1` 判断为活动取消；`1` 在样例中为已发布 |
| `SFYXQXYY` | 是否允许取消，观察存在数字／字符串；不属于预约成功判断 |

列表需要合并：

1. `hdlbList.WID` 与 `hdrsList.HD_WID` 关联，取得 `YYRS`；无人数行时学校前端置 0。v0.3.0 助手额外保留 `countKnown:false`，重试时不据此假定真实零人数。
2. `hdlbList.WID` 与 `xsxxList.WID` 关联，取得 `YY_WID`、`SFDK`、`SFWY`。
3. 不要误把 `xsxxList.WID` 当成个人预约记录 ID。

“我的活动”使用 `wdhdList.HD_WID` 对应活动 ID；`YY_WID` 非空表示有预约记录。核验目标活动记录存在、预约 ID 非空且活动未取消。不把名单中任何同名活动当作成功，也不把 `FBZT` 单独当作个人预约状态。`SFDK/SFWY` 是打卡／违约状态；不推测未记录的取值。

## 验证码与提交

取验证码不带活动 ID。返回的是完整 data URI，没有独立图片链接；保留原 MIME，不强行改成 PNG。取图只是获取挑战，没有证据说明它占住名额。

实际验证码错误响应：

```json
{"msg":"验证码错误，请重试！注意不要同时使用多台设备进行预约操作。","datas":null,"debugException":null,"code":-1}
```

这个错误没有证明首次失败的具体原因。验证码寿命、多次取图覆盖规则、跨标签页绑定均未知。第一版单任务串行取图，不在已有输入期间后台换图。

v0.4.0 在开放前取图识别并预填答案，开放时直接提交最终答案；已开放时也允许按钮／回车提交。网络超时先核验，不自动重发。明确验证码错误查询余位后换图重试，满员停止。验证码的提前有效期尚待实网验证。

## 前置检查的修正

当前 `activity.js` 列表卡片调用同步 `appiontCheck` 后取图；当前 `hdxq.js` 详情页的 `actionApply` 直接调用 `vcode`，没有这一步。此前“学校所有预约入口都先检查”的说法不准确。

已观察未开放活动检查返回通过，但不知检查是否写会话状态。详情源码提供了直接取图的依据；我们前次完整往返仍有调用检查，所以“新脚本省略检查后的端到端成功”未被实测。

## 时间和重复请求

按上海时间解析无时区日期，不能依赖 Safari 等环境对带空格字符串的 `Date.parse` 行为。`xtdqsj` 为服务端时间；用请求起止时间中点估算偏移，并承认秒精度和网络不对称误差。离线样例的历史时间不能用于当前定时。

列表、详情、我的活动可按需查询，但未获知速率配额。到点取图不依赖列表轮询。验证码网络失败仅有限重试，提交不自动重试；服务端限流提示应停止或遵循明确等待要求。
