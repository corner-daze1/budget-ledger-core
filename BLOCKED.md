# 当前待裁决与限制

更新时间：2026-08-05

## 现役阻塞

- 无现役代码、测试、构建或自动视觉取证阻塞。
- 首页第二版仍待产品方视觉审阅。这是产品决策事项，不是实现失败；确认前不铺开另外三页的内容重绘。

## 发布前待完成

- 隔离自动取证不能替代真实账本的数据安全验证。正式发布前需在用户明确授权的环境中完成 JSON 导出、恢复、关闭重开和真机冒烟。
- 首版尚无正式小程序主体和生产 AppID；当前 `wx9567fb4ff6336d0b` 是测试 ID，不得把自动取证数据写入其中。
- 旧任务中的 21–23 号真实 UI 证据及状态恢复闭环仍未验证。Computer Use 对 Stable 的 NW.js 窗口持续返回所有权矛盾，无法建立可信的读取—操作—复核闭环；不得用历史截图、旧 `match=true` 或占位文件替代。

## 已知但不阻塞

- Stable/automator 每个会话会发送固定形态的 `type:error, args:[{}]` 空对象协议事件。脚本原样记录并单列为 `protocolArtifacts`；应用 error、exception、warning、timeout 和 runtimeErrors 仍分别判定。该事件的官方来源尚未确认，禁止扩大忽略规则。
- 日常视觉验收已经改用 `.visual-qa`、`touristappid` 和独立 CLI/automator 会话，不依赖 Computer Use。
- `artifacts/visual-evidence/lifecycle-red.txt` 与 `session-retry-red.txt` 是报警器的反向验证证据，按设计保留，不是清理残留。

## 已解除

- `touristappid` 被误传给 `--auto-account` 的账号错误。
- 截图超时后复用同一 runtime 导致重试继续超时。
- 失败后遗留旧 PNG、manifest 或 green 标记的假成功风险。
- Tab 页使用 `redirectTo` 导致的自动取证冲突；当前首页 fixture 使用单一 `switchTab` 助手。
- 启动页 home-first 契约与小程序检查器旧页面顺序冲突；当前 app、测试与检查器统一为 home、settings、entry、bills。

## 证据边界

- 阶段十三最后一次自动视觉取证已生成兼容样图和四态首页证据，命令真实退出 0。
- 随后的启动页修复只调整页面声明顺序、对应测试和检查器，没有重跑视觉取证，也没有把旧证据伪装为新运行结果。
- 详细历史错误、窗口 ID 和中间测试数字保留在 Git 历史与 `artifacts/`，不再重复堆入现役文档。
