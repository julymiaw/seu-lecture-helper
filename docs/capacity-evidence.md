# 人数与满员状态：当前页面证据

核对时间：2026-10-12 21:49（Asia/Shanghai）。绑定用户已打开的内置浏览器标签页，读取当前已加载脚本、RequireJS 模板缓存和 DOM，并同源发送一次空表单列表查询。没有刷新页面、预约、取消、取验证码或启动轮询。只记录活动公开字段，没有保存凭据和个人预约记录。

## 当前源码链路（已验证）

实际加载的 [hdyy.js](https://ehall.seu.edu.cn/gsapp/sys/yddjzxxtjappseu/modules/hdyy/hdyy.js?v=20211117)：

- 第 79 行：`mobileUtil.doPost(basePath + '/modules/hdyy/queryActivityList.do', {})`。
- 第 96–110 行：从 `hdlbList` 取得活动和容量 `HDZRS`；从 `hdrsList` 按 `HD_WID` 对应活动的 `WID`，填入 `YYRS`。没有人数行时，学校前端默认 `'0'`。
- 第 129–170 行：先区分个人是否已预约；未预约时依次判断活动取消、未开放、预约结束，再判断满员。

满员分支的原始条件是相等比较，而非 `>=`：

```js
} else if (rowData.YYRS == rowData.HDZRS) {
    // 人数已满
    rowData.btn_rsym = true;
} else {
    // 活动未预约，可预约
    rowData.btn_yy = true;
}
```

当前 RequireJS 缓存中的 [activityIndexPage.html](https://ehall.seu.edu.cn/gsapp/sys/yddjzxxtjappseu/public/components/activity/activityIndexPage.html) 显示：

```html
<mt-text v-if="!item.HD_WID" class="activity-pic-text2">{{item.YYRS}}/{{item.HDZRS}}</mt-text>
<button v-if="item.btn_rsym" class="ydd-button-small button-default">人数已满</button>
```

因此人数和满员按钮均来自同一份列表数据，不需要额外请求一个“是否已满”的接口。

## 一次实时接口与当前 DOM 对照（已验证）

请求：`POST /gsapp/sys/yddjzxxtjappseu/modules/hdyy/queryActivityList.do`，空表单，同源浏览器登录态。HTTP 200、业务 `code:0`；响应正文 UTF-8 长度 13,077 字节；`datas.xtdqsj` 为 `2026-10-12 21:49:00`。

| 活动 | 接口 YYRS / HDZRS | 当前 DOM | 当前学校按钮 |
|---|---|---|---|
| 别让情绪偷偷“超载”（线上） | 150 / "150" | 150/150 | 人数已满 |
| 同场线下 | 650 / "650" | 650/650 | 人数已满 |
| 购票福利 | 650 / "5000" | 648/5000 | 取消预约 |

另外三项未开放活动没有对应 `hdrsList` 行，页面按源码默认显示 0 人；这说明缺失人数行确实出现在正常响应中，但无法仅凭这一次响应证明所有缺失都表示真实零人数。

## 刷新和监测结论

当前 `hdyy.js` 的 `activated` 调用 `loadData`；切换栏目触发 `reSetData`，它清空列表后重新查询。当前 [activity.js](https://ehall.seu.edu.cn/gsapp/sys/yddjzxxtjappseu/public/components/activity/activity.js?v=20211117) 在学校自己的预约／取消成功后发出 `reSetData`，父模板绑定该事件重新加载。

这份列表模块没有 `setInterval` / `setTimeout` 定时刷新逻辑。实时查询时购票福利已是 650 人，DOM 仍为 648 人，直接证明现有页面显示可滞后于一次新查询；这不是对后台人数更新延迟的测量。

可以复用已验证的列表接口做低频余位监测，按 `max(0, Number(HDZRS) - Number(YYRS))` 计算快照余位。满员时无需取验证码或提交；一次列表请求可检查多个目标。不以学校原按钮作为监测依据。

仍未验证：是否存在未被当前列表模块使用的更小人数接口、后台统计／缓存刷新延迟、名额释放到列表变化的时间、完整捡漏成功流程。源码不能证明后台没有其他接口，也不能证明查询到余位就锁定名额。
