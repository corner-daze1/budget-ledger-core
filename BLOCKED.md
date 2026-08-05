# 当前待裁决与限制

更新时间：2026-08-05

## 现役阻塞

- 无现役代码、测试、构建或自动视觉阻塞。
- 首页视觉产品审阅仍属于后续人工事项；本阶段不铺开另外三页内容重绘。
- 21–23 号真实 UI 证据及本轮状态恢复核对仍受 Stable 窗口绑定/状态读取失败阻塞，细节见文末收尾记录。

## 发布前待完成

- 隔离自动取证不能替代真实账本的数据安全验证。正式发布前仍需在用户明确授权的环境中完成 JSON 导出、恢复、关闭重开和真机冒烟。
- 首版尚无正式小程序主体和生产 AppID；当前 `wx9567fb4ff6336d0b` 是测试 ID，不得把自动取证数据写入其中。

## 已知但不阻塞

- Stable/automator 每个会话会发送五条固定形态的 `type:error, args:[{}]` 空对象协议事件。脚本原样记录并单列为 `protocolArtifacts`；当前应用 error、exception、timeout 和 runtimeErrors 均为 0。该事件的官方来源尚未确认，禁止扩大忽略规则。
- Computer Use 曾持续返回 NW.js 窗口归属错误。日常视觉验收已改用独立 CLI/automator 会话，因此它不再阻塞首页迭代；需要真实可见 UI 操作的发布冒烟仍可能受影响。
- `artifacts/visual-evidence/lifecycle-red.txt` 与 `session-retry-red.txt` 是现役报警器的反向验证证据，按设计保留，不是待清理残留。

## 已解除

- 把 `touristappid` 错传给 `--auto-account` 导致的账号错误。
- 截图挂起后复用同一 runtime，令后续重试一起超时。
- 兼容性或关闭失败仍遗留 `ok:true`、旧 PNG、manifest 或 green 的假成功风险。
- 四态自动取证缺失；当前兼容探针和四态命令均已真实通过。
- 2026-08-05 已按用户确认清理一次性会话残留、可重建 QA 副本和被替代的阶段九中间证据。

## 阶段十基线提交差异（2026-08-05）

- 任务书记录的基线为 `ff89517`，但实测 `git rev-parse --short HEAD` 返回 `9f8ad8e`，工作区当时干净。该差异无法仅凭任务书推断原因。
- 已完成且通过任务0：`npm ci`、`build:mini`、`npm test` 356/356、`npm run check` 359 declarations、`check:mini`；未修改业务/UI文件。
- 后续以当前仓库为权威继续；最终仍执行 `git diff --exit-code ff89517 -- src scripts`，若基线不存在或差异不为零，保留原始输出并报告，不伪造通过。

## 历史任务2：21–23号证据与恢复闭环（2026-08-05）

- 当前仍缺少 `artifacts/phase9/21-private-backup-proof.txt`、`artifacts/phase9/22-home-prepaid-top-iphone12-13.png` 和 `artifacts/phase9/23-home-prepaid-top-iphone5-320.png`；没有用旧 PNG、旧备份或占位文件补齐。
- Stable 确实存在且能显示真实设置页，但 Computer Use 只能取得截图，无法取得可访问树。窗口 ID `4131396` 的重绑定/激活原始错误为：`window id 4131396 no longer belongs to nwjs._nwjs_mbeehgnikfbgjh.80d774828fb0.Default; current owner is nwjs._nwjs_mbeehgnikfbgjh.80d774828fb0.Default`；输入后刷新还出现 `node_repl exec context not found`，不能证明点击已生效。
- 在可验证状态恢复前，不能安全执行导出、制造预支支出、导入恢复或声称 `match=true`。因此本轮未改变账本、未访问测试 AppID 存储、未创建仓库外备份，也未修改业务代码、测试或配置。
- `artifacts/phase9/17-state-restore-check.txt` 仅是历史参考，不替代本轮 UI 导出→预支截图→恢复前后核对；需要有效的 Stable/Computer Use 窗口绑定后从可见 UI 重新完成。

## 历史任务2：Stable 重开后的复核结果（2026-08-05）

- 已终止旧 Stable 主窗口并按原用户数据目录重新启动；新项目窗口被发现为 ID `2887566`，但状态读取仍返回同一所有权矛盾：`window id 2887566 no longer belongs to nwjs._nwjs_mbeehgnikfbgjh.80d774828fb0.Default; current owner is nwjs._nwjs_mbeehgnikfbgjh.80d774828fb0.Default`。
- 用 `process:C:\Program Files (x86)\Tencent\微信web开发者工具\wechatdevtools.exe` 代替 `nwjs` 标识再次验证时，Computer Use 会话返回 `Error: node_repl exec context not found`；因此仍没有可信的可访问树、点击确认或截图闭环。
- 21/22/23 证据继续缺失；未执行导出、预支、恢复或清除，未访问测试 AppID 存储，未制造占位证据。状态恢复的 `match=true` 仍未验证，历史 `17-state-restore-check.txt` 不得升格为当前证据。

## 历史任务2：21–23最终核对（2026-08-05）

- 按用户要求没有重跑已完成自动门禁。重新调用 `list_apps()` 后，Stable 项目窗口唯一返回为 ID `2887566`。
- 对该次返回的窗口对象执行状态读取仍返回：`window id 2887566 no longer belongs to nwjs._nwjs_mbeehgnikfbgjh.80d774828fb0.Default; current owner is nwjs._nwjs_mbeehgnikfbgjh.80d774828fb0.Default`。
- 按 Computer Use 恢复规程在重新选择/重试后停止，不使用旧坐标或旧状态；因此没有可信 UI 闭环，21/22/23 证据和恢复前后 `match=true` 仍不能声称完成。
- 未点击导出、预支、恢复或清除，未访问测试 AppID 存储，未创建占位证据；本轮仅更新进度与阻塞文档，未提交 Git。

## 历史：阶段十自动视觉取证阻塞（2026-08-05，已解除）

- `npm run evidence:visual -- --compat` 已用三个不同端口分别真实运行三次，均在兼容性 fixture 的 `redirectTo('/pages/home/home')` 处失败；每次 QA 会话均由脚本确认关闭，未复用 runtime。
- automator 协议日志确认原始 RPC 为 `App.callWxMethod`，返回 `error.message="Uncaught [object Object]"`；当前 `/pages/home/home` 已是 tab 页，微信运行时拒绝用 `redirectTo` 进入 tab 页。五条空对象 console 事件仍按协议伪影记录，不当作应用错误吞掉。
- 取证脚本属于禁止修改的判卷标准，页面级 `wx.redirectTo` 兼容层试验也无法影响 `App.callWxMethod`，已还原；未生成成功 `compatibility.json`、sample PNG、四态新版 PNG 或 green manifest，不伪造视觉通过。
- 当时可继续验证的代码、业务测试、构建、静态检查和阶段十导航反向红→绿均已完成；该脚本/运行时路径冲突已由阶段十三允许的首页 Tab 助手修复，历史失败不再是现役阻塞。

## 阶段十三视觉取证解除记录（2026-08-05）

- 按新任务允许范围，取证脚本将 fixture 首页进入从 `redirectTo` 改为经 `withSessionTimeout` 的单一 `switchToHomeTab`；旧逻辑 17 项中 1 项真实失败，改后视觉单测 17/17。
- `npm run evidence:visual -- --compat` 真实退出 0，生成 `compatibility.json` 与 `compatibility/sample.png`；`npm run evidence:visual` 真实退出 0，生成四张新版 PNG、`manifest.json` 与 `four-states-green.txt`。
- 本轮未使用测试 AppID 或真实账本；协议空对象事件仍保留并计数，不当作应用错误吞掉。

## 启动页修复与检查器同步（2026-08-05）

- 启动页代码和导航测试已转绿：`app.json.pages` 与目标测试统一为 home、settings、entry、bills，目标测试 21/21。
- 旧检查器仍硬编码 settings、home、entry、bills，导致 `npm run check:mini` 以旧错误退出 1；该冲突已按本轮授权仅同步检查器顺序和错误文案。
- 同步后 `npm run check:mini` 退出 0；临时恢复旧顺序时真实退出 1，并显示 `app.json must declare the ledger-first four-page order`。
- 旧顺序已立即用补丁恢复为 home、settings、entry、bills，恢复后 `npm run check:mini` 再次退出 0。
- 页面、样式、导航、视觉证据、依赖、项目配置和其他检查逻辑均未改；当前该阻塞已解除，无新增未解决阻塞。

## 历史任务2：21–23最终收尾（2026-08-05）

- Stable 重开后再次由 `list_apps()` 唯一返回项目窗口 `2887566`；按规程重新绑定并读取状态失败，原始错误仍为：`window id 2887566 no longer belongs to nwjs._nwjs_mbeehgnikfbgjh.80d774828fb0.Default; current owner is nwjs._nwjs_mbeehgnikfbgjh.80d774828fb0.Default`。
- 按恢复规程重新选择窗口后仅重试一次，仍为同一错误；随后停止输入，不复用旧坐标、截图或可访问树。
- 21/22/23 证据文件仍缺失；未执行导出、预支、恢复或清除，未访问测试 AppID 账本，也未创建占位文件。
- 历史 `artifacts/phase9/17-state-restore-check.txt` 的 `match=true` 不替代本轮 UI 闭环；状态恢复本轮仍未验证。当前阻塞未解除，原因是 Stable 窗口绑定/状态读取不可用。
