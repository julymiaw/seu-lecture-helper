# 信息采集记录

日期：2026-10-12，Asia/Shanghai。项目目录外的 `evidence-2026-10-12/` 保存此前网络往返证据；`local-research/` 保存本轮本地采集。它们不属于待上传仓库。

## 已取得

- 前次购票福利取消、恢复预约成功与验证码错误的实际响应；同源直接提交及列表／我的活动核验。
- 本轮当前列表 DOM、6 张卡片的最小 HTML、只读 Vue 组件链中的活动 ID 和活动数据。
- 本轮学校 `activityIndexPage.html`、`hdyyIndexPage.html`、`hdyyBS.js`、`hdxq.js`、`hdxqIndexPage.html`；与已有 `activity.js`、`hdyy.js` 对照。
- 列表的三集合合并、详情接口的参数与字段读取、两个页面不同的预约前检查行为。
- 学校前端是 Vue 2 SPA；详情通过 hash 的 WID 定位活动。当前列表卡片没有可直接使用的 ID attribute。

读取静态资源时必须保留实际资源 URL 的 `?v=20211117`；无版本 URL 曾读取失败。本轮后续活动列表、详情、我的活动读取出现连接错误和超时，未取得新的成功 HTTP 样例，不用当前页面缓存数据冒充新响应。请求工具本身的等待时间不作为服务器耗时。

本轮没有发送 addReservation、deleteReservation，也未识别或提交验证码；没有安装或运行候选脚本，没有改动学校 DOM／状态。活动仍以当前读取状态为准，未执行状态恢复操作。

## 来源

应用根：`https://ehall.seu.edu.cn/gsapp/sys/yddjzxxtjappseu/`

| 路径（相对于应用根，静态资源带 `?v=20211117`） | 关键依据 |
|---|---|
| `modules/hdyy/hdyy.js` | 列表数据合并与状态规则、我的活动参数 |
| `public/components/activity/activity.js` | 列表检查→验证码→提交 |
| `public/components/activity/activityIndexPage.html` | 卡片、标题、原按钮区域 |
| `modules/hdxq/hdxq.js` | POST 详情，读取 datas.hdxq；直接验证码→提交 |
| `modules/hdxq/hdxqIndexPage.html` | 详情布局和 .hdxq-foot |

文件哈希见 `tests/fixtures/manifest.json`，仅用于追溯采集版本，不代表发布许可。发布目录不拷贝学校源码全文。

## 判断边界

“可以开始本地开发与离线测试”已满足；“保证后续不需要任何真实页面验收”不能由资料收集推出。第一版可以完全离线开发，不进行自动实网测试；最终报告必须把离线通过与实网未验收分开。

前期项目比较中“不同协议所以 fetch_lecture 已过时”的推论已撤回：它 README 明确面向研究生，但其另一入口是否有效未实测。新项目依据当前入口实证独立实现，不复制候选项目代码。
